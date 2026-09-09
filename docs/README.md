# Project documentation

## Start here

Read the [User Guide](USER_GUIDE.md) to open the application, create a demo order, track its progress, understand errors, and recover interrupted work. No knowledge of RabbitMQ or database schemas is needed for normal use.

| Your task | Guide |
| --- | --- |
| Use or present the application | [User Guide](USER_GUIDE.md) |
| Run it on your computer | [Local startup and testing](PART_10_VALIDATION.md) |
| Configure Vercel, backend access, and release checks | [Deployment guide](../DEPLOYMENT.md) |
| Exercise API requests and failure scenarios | [Postman guide](../postman/README.md) |
| Develop or test the frontend | [Frontend guide](../apps/web/README.md) |

## Technical reference

These short references explain the implementation for developers and reviewers. They are not prerequisites for using the interface.

- [Contracts and business rules](PART_1_CONTRACTS.md)
- [Database ownership and migrations](PART_2_DATABASES.md)
- [Payment service](PART_3_PAYMENT.md)
- [Inventory service](PART_4_INVENTORY.md)
- [Shipping service](PART_5_SHIPPING.md)
- [Order orchestration](PART_6_ORCHESTRATION.md)
- [Compensation](PART_7_COMPENSATION.md)
- [RabbitMQ messaging](PART_8_MESSAGING.md)
- [Recovery and observability](PART_9_RECOVERY.md)

**Scope:** this is a demonstration system. Payment and shipping are simulated. Use fictional data, protect private deployments, and verify live behavior before a presentation. Local test results do not guarantee hosted availability.
