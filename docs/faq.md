# FAQ

Common questions about deploying and running StoreAI. See also
[troubleshooting.md](troubleshooting.md) for specific error fixes.

### Do I need GPUs or Trainium to run StoreAI?

No Trainium, but yes to a GPU. The default deployment runs on Graviton, with one or more NVIDIA GPUs
for Whisper speech-to-text and the FASHN try-on engine (both enabled by default). AWS
Trainium is only needed if you choose to self-host the LLM or the Qwen Image-Edit try-on model
(`image-edit-model`) — both off by default. See [self-hosted-models.md](self-hosted-models.md).

### What does "one command" actually deploy?

`deploy/storeai up` provisions the network, EKS cluster, data plane, container registry, MCP Lambdas,
the LiteLLM gateway, application services, the CloudFront distribution, seeds the sample catalog, and
creates a Cognito sign-in user — in dependency order, with the edge/load-balancer wiring handled
internally. Prerequisites (an AWS account, Bedrock access, a Terraform state bucket) are assumed to be
in place.

### Can I deploy just one part, like only the image-editing model?

Yes. Every module deploys standalone and the deployer resolves its dependencies:
`./deploy/storeai up --module image-edit-model`. See the module list in
[architecture.md](architecture.md#modules).

### How do I switch the chat model to a self-hosted one?

Register it under `engines.llm.backends` in `storeai.config.json` and set `engines.llm.default` (or set
`CHAT_MODEL` on the orchestrator). All model calls route through the LiteLLM gateway, so this is a
configuration change, not a code change. See [configuration.md](configuration.md).

### How is cost calculated? Is it my real AWS bill?

No. The cost shown in the UI is an **estimate** of AI-inference cost, computed from a config-driven
price table, plus a separate rough infrastructure estimate. It is not your actual AWS bill — use the
AWS Pricing Calculator and Cost Explorer for that.

### Does my conversation persist if the orchestrator restarts?

Chat **history** is persisted to DynamoDB and reloads on sign-in. The LangGraph in-flight
conversation state uses an in-memory checkpointer by default, so that portion does not survive a
restart. See [security.md](security.md) for how to change this.

### Does the assistant remember me between visits?

Yes, for signed-in customers. When a session ends, the assistant saves a short summary of your
preferences, sizes, and purchases to long-term memory (embedded and stored in
[Amazon S3 Vectors](https://aws.amazon.com/s3/features/vectors/) plus a DynamoDB record), and on
your next visit it semantically recalls the most relevant of those to personalize recommendations.
Guests have no long-term memory. See [security.md](security.md) for the privacy details; `down --all`
deletes all stored memory.

### What AWS services does StoreAI use?

The core deployment uses Amazon EKS (compute), AWS Lambda (MCP tools), Amazon Bedrock (chat, voice,
and content-safety models), Amazon DynamoDB (catalog and shopping state), Amazon S3 (images and the
static site), Amazon S3 Vectors (long-term memory), Amazon CloudFront (the only public ingress),
Amazon Cognito (authentication), and Amazon ECR (container images).

### How much does it cost to run?

Only an estimate is possible — it depends on your region, traffic, and which optional models you
enable. On-demand infrastructure (EKS, a NAT gateway, Lambdas) runs continuously while deployed, while
accelerator workloads (GPU/Trainium) scale to zero when idle, so per-request model inference is the
main variable cost. Use the [AWS Pricing Calculator](https://calculator.aws/) and Cost Explorer for
figures specific to your account. (The in-UI figure is only an estimate of AI-inference cost — see the
question above.)

### Does it work outside `us-east-2`?

Yes, with caveats. Set `global.region` in `storeai.config.json` to your region, and ensure Bedrock
model access is enabled there and that Amazon S3 Vectors is available in that region. One fixed
dependency: **Amazon Nova Sonic voice is `us-east-1` only**, so the voice service calls Nova Sonic in
`us-east-1` regardless of your deployment region.

### How do I remove everything?

`./deploy/storeai down --all` tears down all provisioned resources in reverse dependency order. Your
Terraform state bucket is never deleted.

### Is this production-ready as-is?

It is a **reference architecture** — a complete, working system to study and adapt. Review
[security.md](security.md) (default credentials, CORS, checkpointer, authentication) before any
non-demo use.

### How do I report a security issue?

Do not open a public issue — follow the process in
[CONTRIBUTING.md](../CONTRIBUTING.md#security-issue-notifications).
