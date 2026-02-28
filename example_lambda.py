"""Example Lambda function that processes order notifications."""

import boto3
import json

def handler(event, context):
    """Process order notification and store in S3, send to SQS."""
    
    # Initialize AWS clients
    s3 = boto3.client('s3')
    sqs = boto3.client('sqs')
    dynamodb = boto3.resource('dynamodb')
    
    # Store order data in S3
    order_id = event.get('order_id')
    s3.put_object(
        Bucket='vyapargyan-orders',
        Key=f'orders/{order_id}.json',
        Body=json.dumps(event)
    )
    
    # Send notification to SQS
    sqs.send_message(
        QueueUrl='https://sqs.ap-south-1.amazonaws.com/123456789012/order-notifications',
        MessageBody=json.dumps(event)
    )
    
    # Update DynamoDB table
    table = dynamodb.Table('Orders')
    table.update_item(
        Key={'order_id': order_id},
        UpdateExpression='SET #status = :status',
        ExpressionAttributeNames={'#status': 'status'},
        ExpressionAttributeValues={':status': 'processed'}
    )
    
    return {'statusCode': 200, 'body': 'Order processed'}
