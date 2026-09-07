variable "aws_region" {
  description = "AWS region to deploy into"
  type        = string
  default     = "us-east-1"
}

variable "upstream_base_url" {
  description = "Base URL of the upstream vehicle-info API (no trailing slash)"
  type        = string
  default     = "https://insurance-webhook-945894769129.us-central1.run.app"
}

variable "lambda_timeout_seconds" {
  description = "Lambda function timeout in seconds. Must exceed upstream_timeout_ms / 1000."
  type        = number
  default     = 10
}

variable "upstream_timeout_ms" {
  description = "Hard timeout for each upstream HTTP request in milliseconds"
  type        = number
  default     = 5000
}

variable "max_retries" {
  description = "Number of retry attempts for transient upstream failures (0 = no retries)"
  type        = number
  default     = 2
}

variable "log_retention_days" {
  description = "CloudWatch log group retention in days"
  type        = number
  default     = 7
}

variable "function_name" {
  description = "Name for the Lambda function and associated resources"
  type        = string
  default     = "vehicle-info"
}
