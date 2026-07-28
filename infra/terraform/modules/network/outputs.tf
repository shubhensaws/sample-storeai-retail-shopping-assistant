output "vpc_id" {
  value = aws_vpc.main.id
}

output "public_subnet_ids" {
  value = [for s in aws_subnet.public : s.id]
}

output "private_subnet_ids" {
  value = [for s in aws_subnet.private : s.id]
}

# Map of AZ -> private subnet id. Keys (AZ names) are known at plan time, so
# consumers can select a subnet by AZ without a for_each over unknown subnet ids
# (avoids the "Invalid for_each argument" error on a fresh apply).
output "private_subnet_ids_by_az" {
  value = { for s in aws_subnet.private : s.availability_zone => s.id }
}

output "endpoints_sg_id" {
  value = aws_security_group.endpoints.id
}

output "nat_public_ip" {
  value = aws_eip.nat.public_ip
}
