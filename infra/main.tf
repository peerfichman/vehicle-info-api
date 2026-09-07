# ---------------------------------------------------------------------------
# IAM — Lambda execution role
# ---------------------------------------------------------------------------

data "aws_iam_policy_document" "lambda_assume_role" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "lambda_exec" {
  name               = "${var.function_name}-lambda-exec"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume_role.json
}

# Explicit, least-privilege CloudWatch Logs policy scoped to this function's log group.
# Deliberately NOT using AWSLambdaBasicExecutionRole to keep permissions minimal.
data "aws_iam_policy_document" "lambda_logs" {
  statement {
    effect = "Allow"
    actions = [
      "logs:CreateLogStream",
      "logs:PutLogEvents",
    ]
    resources = [
      "${aws_cloudwatch_log_group.lambda.arn}:*",
    ]
  }
}

resource "aws_iam_role_policy" "lambda_logs" {
  name   = "${var.function_name}-logs"
  role   = aws_iam_role.lambda_exec.id
  policy = data.aws_iam_policy_document.lambda_logs.json
}

# ---------------------------------------------------------------------------
# CloudWatch Logs — explicit group with retention (avoids implicit group with
# no retention that Lambda would otherwise create)
# ---------------------------------------------------------------------------

resource "aws_cloudwatch_log_group" "lambda" {
  name              = "/aws/lambda/${var.function_name}"
  retention_in_days = var.log_retention_days
}

# ---------------------------------------------------------------------------
# Lambda Layer — third-party runtime deps (zod only)
# AWS SDK v3 is provided by the Lambda runtime and must NOT be in the layer.
# ---------------------------------------------------------------------------

resource "aws_lambda_layer_version" "deps" {
  layer_name          = "${var.function_name}-deps"
  filename            = "${path.module}/../artifacts/layer.zip"
  source_code_hash    = filebase64sha256("${path.module}/../artifacts/layer.zip")
  compatible_runtimes = ["nodejs22.x"]
  description         = "zod — third-party runtime dependencies"
}

# ---------------------------------------------------------------------------
# Lambda Function
# ---------------------------------------------------------------------------

resource "aws_lambda_function" "vehicle_info" {
  function_name    = var.function_name
  filename         = "${path.module}/../artifacts/function.zip"
  source_code_hash = filebase64sha256("${path.module}/../artifacts/function.zip")
  handler          = "handler.handler"
  runtime          = "nodejs22.x"
  role             = aws_iam_role.lambda_exec.arn
  timeout          = var.lambda_timeout_seconds
  memory_size      = 256
  layers           = [aws_lambda_layer_version.deps.arn]

  environment {
    variables = {
      UPSTREAM_BASE_URL    = var.upstream_base_url
      UPSTREAM_TIMEOUT_MS  = tostring(var.upstream_timeout_ms)
      UPSTREAM_MAX_RETRIES = tostring(var.max_retries)
      LOG_LEVEL            = "info"
    }
  }

  depends_on = [
    aws_cloudwatch_log_group.lambda,
    aws_iam_role_policy.lambda_logs,
  ]
}

# ---------------------------------------------------------------------------
# API Gateway — HTTP API (payload format v2)
# ---------------------------------------------------------------------------

resource "aws_apigatewayv2_api" "vehicle_info" {
  name          = var.function_name
  protocol_type = "HTTP"
  description   = "Vehicle Info API — wraps upstream vehicle lookup"
}

resource "aws_apigatewayv2_integration" "lambda" {
  api_id                 = aws_apigatewayv2_api.vehicle_info.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.vehicle_info.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "post_vehicle_info" {
  api_id    = aws_apigatewayv2_api.vehicle_info.id
  route_key = "POST /vehicle-info"
  target    = "integrations/${aws_apigatewayv2_integration.lambda.id}"
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.vehicle_info.id
  name        = "$default"
  auto_deploy = true
}

# Grant API Gateway permission to invoke the Lambda function.
resource "aws_lambda_permission" "apigw" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.vehicle_info.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.vehicle_info.execution_arn}/*/*"
}
