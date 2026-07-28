output "function_arns" {
  value = { for k, f in aws_lambda_function.mcp : k => f.arn }
}

output "function_names" {
  value = { for k, f in aws_lambda_function.mcp : k => f.function_name }
}

output "role_arn" {
  value = aws_iam_role.mcp.arn
}
