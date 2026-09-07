output "invoke_url" {
  description = "Base URL for the deployed API"
  value       = aws_apigatewayv2_stage.default.invoke_url
}

output "curl_example" {
  description = "Ready-to-run curl command to test the deployed endpoint"
  value       = "curl -s -X POST ${aws_apigatewayv2_stage.default.invoke_url}/vehicle-info -H 'Content-Type: application/json' -d '{\"license_plate\":\"12345678\"}' | jq ."
}
