"""Memory MCP — write_memory, read_memory, summarize_session.

Long-term customer memory backed by:
  - Amazon S3 Vectors  — cost-optimized vector store for semantic recall
                         (Titan Text Embeddings v2, 1024-dim, cosine).
  - Amazon DynamoDB    — durable record + recency fallback if a vector query
                         fails or no query text is supplied.

S3 Vectors is a new service whose client ships in boto3 >= 1.39. The Lambda
python3.12 runtime bundles an older boto3, so a recent boto3 is vendored into
_vendor/ (see requirements.txt + the lambdas Terraform module) and put on the
path before boto3 is imported.
"""
import os
import sys

# Vendored boto3 (>=1.40) — required because the Lambda runtime's bundled boto3
# predates the s3vectors client. Must precede the boto3 import.
_VENDOR = os.path.join(os.path.dirname(__file__), "_vendor")
if os.path.isdir(_VENDOR) and _VENDOR not in sys.path:
    sys.path.insert(0, _VENDOR)

import json
import uuid
from datetime import datetime, timezone

import boto3

_region = os.environ.get("AWS_REGION", "us-east-2")

dynamodb = boto3.resource("dynamodb")
memory_table = dynamodb.Table(os.environ.get("MEMORY_TABLE", "ConversationMemory"))
bedrock = boto3.client("bedrock-runtime", region_name=_region)

# S3 Vectors
VECTOR_BUCKET = os.environ.get("VECTOR_BUCKET", "")
MEMORY_INDEX = os.environ.get("MEMORY_INDEX", "customer-memory")
_s3vectors = None

EMBED_MODEL = "amazon.titan-embed-text-v2:0"
EMBED_DIM = 1024
SUMMARIZE_MODEL = "us.anthropic.claude-haiku-4-5-20251001-v1:0"


def _get_s3vectors():
    """Lazily create the s3vectors client; None if the bucket isn't configured."""
    global _s3vectors
    if not VECTOR_BUCKET:
        return None
    if _s3vectors is None:
        _s3vectors = boto3.client("s3vectors", region_name=_region)
    return _s3vectors


def _embed_text(text: str) -> list[float]:
    resp = bedrock.invoke_model(
        modelId=EMBED_MODEL,
        body=json.dumps({"inputText": text}),
        accept="application/json",
        contentType="application/json",
    )
    body = json.loads(resp["body"].read())
    return body.get("embedding", [0.0] * EMBED_DIM)


def respond(code, body):
    return {"statusCode": code, "body": json.dumps(body, default=str)}


def write_memory(p):
    cid = p.get("customer_id")
    kind = p.get("kind", "episodic")
    text = p.get("text", "")
    metadata = p.get("metadata", {})
    if not cid or not text:
        return {"error": "customer_id and text required"}

    mid = f"MEM-{uuid.uuid4().hex[:8]}"
    ts = datetime.now(timezone.utc).isoformat()

    # Durable record in DynamoDB (system of record + recency fallback).
    memory_table.put_item(Item={
        "customer_id": cid,
        "created_at": ts,
        "memory_id": mid,
        "kind": kind,
        "text": text,
        "metadata": metadata,
    })

    # Semantic index in S3 Vectors.
    s3v = _get_s3vectors()
    if s3v:
        vector = [float(x) for x in _embed_text(text)]
        vec_meta = {
            "customer_id": cid,
            "kind": kind,
            "text": text,
            "created_at": ts,
            "memory_id": mid,
        }
        if metadata.get("session_id"):
            vec_meta["session_id"] = str(metadata["session_id"])
        s3v.put_vectors(
            vectorBucketName=VECTOR_BUCKET,
            indexName=MEMORY_INDEX,
            vectors=[{"key": mid, "data": {"float32": vector}, "metadata": vec_meta}],
        )

    return {"memory_id": mid}


def read_memory(p):
    cid = p.get("customer_id")
    query = p.get("query", "")
    k = int(p.get("k", 3))
    if not cid:
        return {"error": "customer_id required"}

    # Semantic search via S3 Vectors, scoped to this customer.
    s3v = _get_s3vectors()
    if s3v and query:
        try:
            vector = [float(x) for x in _embed_text(query)]
            resp = s3v.query_vectors(
                vectorBucketName=VECTOR_BUCKET,
                indexName=MEMORY_INDEX,
                queryVector={"float32": vector},
                topK=k,
                filter={"customer_id": {"$eq": cid}},
                returnMetadata=True,
                returnDistance=True,
            )
            memories = []
            for h in resp.get("vectors", []):
                md = h.get("metadata", {}) or {}
                memories.append({
                    "memory_id": md.get("memory_id", h.get("key", "")),
                    "text": md.get("text", ""),
                    "kind": md.get("kind", ""),
                    "created_at": md.get("created_at", ""),
                    "distance": h.get("distance"),
                })
            return {"memories": memories, "source": "s3_vectors"}
        except Exception as e:  # noqa: BLE001 — fall back to recency on any query error
            print(f"[MEMORY] S3 Vectors query failed, falling back to DDB: {e}")

    # Fallback: DynamoDB recency scan (most recent first).
    resp = memory_table.query(
        KeyConditionExpression=boto3.dynamodb.conditions.Key("customer_id").eq(cid),
        ScanIndexForward=False,
        Limit=k,
    )
    return {"memories": resp.get("Items", []), "source": "dynamodb_recency"}


def summarize_session(p):
    """Summarize a session's conversation into a compact memory entry."""
    session_id = p.get("session_id")
    customer_id = p.get("customer_id")
    messages = p.get("messages", [])
    if not customer_id:
        return {"error": "customer_id required"}
    if not messages:
        return {"error": "messages required"}

    conv_text = "\n".join(
        f"{'User' if m.get('role') == 'user' else 'Assistant'}: {m.get('content', '')}"
        for m in messages[-20:]  # last 20 turns max
    )

    summary_prompt = (
        "Summarize this shopping conversation into 2-3 bullet points capturing: "
        "what the customer was looking for, what they liked/disliked, any size/style "
        "preferences mentioned, and what they purchased or tried on. Be concise. "
        "If nothing noteworthy happened, reply with exactly: NOTHING.\n\n"
        f"{conv_text}"
    )

    resp = bedrock.invoke_model(
        modelId=SUMMARIZE_MODEL,
        body=json.dumps({
            "anthropic_version": "bedrock-2023-05-31",
            "max_tokens": 300,
            "messages": [{"role": "user", "content": summary_prompt}],
        }),
        accept="application/json",
        contentType="application/json",
    )
    result = json.loads(resp["body"].read())
    summary = result.get("content", [{}])[0].get("text", "").strip()

    if summary and summary != "NOTHING":
        write_memory({
            "customer_id": customer_id,
            "kind": "session_summary",
            "text": summary,
            "metadata": {"session_id": session_id},
        })
        return {"summary": summary, "session_id": session_id, "stored": True}

    return {"summary": summary, "session_id": session_id, "stored": False}


TOOLS = {
    "write_memory": write_memory,
    "read_memory": read_memory,
    "summarize_session": summarize_session,
}


def lambda_handler(event, context):
    body = json.loads(event.get("body", "{}")) if isinstance(event.get("body"), str) else event
    tool = body.get("tool") or body.get("params", {}).get("name", "")
    args = body.get("arguments") or body.get("params", {}).get("arguments", {})
    fn = TOOLS.get(tool)
    if not fn:
        return respond(400, {"error": f"unknown tool: {tool}"})
    return respond(200, fn(args))
