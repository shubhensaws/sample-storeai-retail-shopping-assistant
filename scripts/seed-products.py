#!/usr/bin/env python3
"""Seed the product catalog (DynamoDB + S3 images).

Usage:
    python3 scripts/seed-products.py --table storeai-<env>-products \
        --images-bucket storeai-<env>-product-images-<ACCOUNT_ID> \
        --data-dir ./data --region <region>
"""
import argparse
import json
import os
from decimal import Decimal
from pathlib import Path

import boto3


def seed_products(table_name: str, data_dir: str, region: str):
    """Load products from YAML or JSON and write to DynamoDB."""
    dynamodb = boto3.resource("dynamodb", region_name=region)
    table = dynamodb.Table(table_name)
    data_path = Path(data_dir)

    products = []

    # Try YAML first (has image_file field)
    yaml_file = data_path / "products.yaml"
    if yaml_file.exists():
        try:
            import yaml
            data = yaml.safe_load(yaml_file.read_text())
            products = data.get("products", data) if isinstance(data, dict) else data
        except ImportError:
            print("  ⚠ PyYAML not installed, trying JSON fallback")

    # JSON fallback
    if not products:
        json_file = data_path / "products.json"
        if json_file.exists():
            data = json.loads(json_file.read_text(), parse_float=Decimal)
            products = data.get("products", data) if isinstance(data, dict) else data

    if not products:
        print(f"  ⚠ No product data found in {data_dir}")
        return 0

    # Clear existing products
    scan = table.scan(ProjectionExpression="product_id")
    if scan["Items"]:
        with table.batch_writer() as batch:
            for item in scan["Items"]:
                batch.delete_item(Key={"product_id": item["product_id"]})
        print(f"  Cleared {len(scan['Items'])} existing items")

    # Seed new products
    count = 0
    with table.batch_writer() as batch:
        for p in products:
            item = {}
            for k, v in p.items():
                if isinstance(v, float):
                    item[k] = Decimal(str(v))
                else:
                    item[k] = v
            batch.put_item(Item=item)
            count += 1

    print(f"  ✓ Seeded {count} products into {table_name}")
    return count


def upload_images(images_bucket: str, data_dir: str, region: str):
    """Upload product images to S3."""
    s3 = boto3.client("s3", region_name=region)
    data_path = Path(data_dir)
    images_dir = data_path / "product_images"

    if not images_dir.exists():
        print(f"  ⚠ No images directory at {images_dir}")
        return 0

    images = list(images_dir.glob("*.png")) + list(images_dir.glob("*.jpg"))
    if not images:
        print(f"  ⚠ No images found in {images_dir}")
        return 0

    uploaded = 0
    for img in images:
        key = f"images/{img.name}"
        content_type = "image/png" if img.suffix == ".png" else "image/jpeg"
        s3.upload_file(
            str(img), images_bucket, key,
            ExtraArgs={"ContentType": content_type},
        )
        uploaded += 1

    print(f"  ✓ Uploaded {uploaded} images to s3://{images_bucket}/images/")
    return uploaded


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Seed StoreAI product catalog")
    parser.add_argument("--table", required=True, help="DynamoDB table name")
    parser.add_argument("--images-bucket", default="", help="S3 bucket for product images")
    parser.add_argument("--data-dir", default="./data", help="Path to data directory")
    parser.add_argument("--region", default=os.environ.get("AWS_REGION", "us-east-2"))
    args = parser.parse_args()

    print("  Seeding product catalog...")
    seed_products(args.table, args.data_dir, args.region)

    if args.images_bucket:
        print("  Uploading product images...")
        upload_images(args.images_bucket, args.data_dir, args.region)
