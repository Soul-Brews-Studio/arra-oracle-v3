# Design: Public Web App + RDS (HA within one region, budget-conscious)

Slug: `public-web-app-rds`
Input: [`constraints.yaml`](./constraints.yaml)
Diagram: [`diagram.mmd`](./diagram.mmd) (rendered `diagram.svg` produced separately by the render step)

## Topology Decision

A single-region, two-AZ VPC with three subnet tiers per AZ (public,
private-app, private-data). Traffic path:

`Internet -> Route 53 -> Internet Gateway -> Application Load Balancer
(public subnets, both AZs) -> ECS Fargate service (private-app subnets,
both AZs) -> RDS PostgreSQL Multi-AZ (private-data subnets, both AZs)`

**Component list:**

| Component | Placement | Role |
|---|---|---|
| Route 53 hosted zone | Global | DNS entry point, alias record to ALB |
| Internet Gateway | VPC-level | Only path in/out of the VPC to the public internet |
| Application Load Balancer | Public subnets, AZ-A + AZ-B | Terminates HTTPS (ACM cert), health-checks targets, only internet-facing compute-adjacent resource |
| ECS Fargate service | Private-app subnets, AZ-A + AZ-B | Runs the web/app containers; scheduler spreads tasks across both AZs |
| RDS for PostgreSQL, Multi-AZ | Private-data subnets, AZ-A (primary) + AZ-B (standby) | Transactional data store, synchronous standby for automatic failover |
| NAT Gateway | Public subnet, AZ-A only (single) | Outbound-only internet access for private subnets (image pulls, external API calls) |
| Secrets Manager | Regional | DB credentials, injected into Fargate tasks at container start, never baked into image/env files |
| S3 bucket | Regional | Static/media asset storage, accessed via IAM task role (not public bucket policy) |

**Why this shape, not alternatives:**

- **ECS Fargate over EC2 Auto Scaling Group** for compute: no AMI patching
  or capacity planning to manage, and billing is per-task rather than
  per-provisioned-instance-hour. At this workload's stated scale (small-to-
  medium, not enterprise), the utilization needed for EC2 Reserved/Savings
  Plans discounts to beat on-demand Fargate pricing typically doesn't
  materialize — so Fargate wins on both operational cost (less ops labor)
  and infra cost at this scale.
- **RDS for PostgreSQL Multi-AZ over Aurora** for the database: Aurora's
  storage/IO pricing floor and minimum instance sizing exceed what a
  small-to-medium workload needs, and nothing in `constraints.yaml` asks
  for Aurora's read-scaling (no read-replica requirement stated). Standard
  RDS Multi-AZ already satisfies the stated RTO/RPO (see Reliability
  trade-off below) at a materially lower baseline cost.
- **Three subnet tiers (public / private-app / private-data) over a single
  flat private subnet**: subnets and route tables carry no direct AWS
  cost, so segmenting the data tier into its own subnet is free network-
  layer defense-in-depth (RDS is reachable only from the app tier's
  security group, enforced at both the subnet route table and the security
  group level) — there was no cost reason not to do this, so it's included
  even though compliance wasn't a stated driver.

## Trade-offs

### Reliability (AWS Well-Architected)

- **Chose RDS Multi-AZ (single synchronous standby) over a Multi-AZ
  cluster with multiple readable standbys** because the stated
  availability requirement is "HA within one region" surviving a single
  AZ loss, not read-scaling or sub-30-second failover. A single standby
  gives synchronous replication (RPO ~= 0) and automatic failover in
  60-120 seconds, which satisfies the stated RTO/RPO in
  `constraints.yaml` without paying for the extra reader nodes a
  Multi-AZ cluster would add.
- **Chose a single NAT Gateway over one NAT Gateway per AZ** — this is
  the one place Reliability and Cost Optimization pull in opposite
  directions, and it's resolved explicitly in favor of cost here: a
  single NAT Gateway in AZ-A means that if AZ-A itself has an outage,
  the private-app subnet in AZ-B loses outbound internet access (e.g.
  cannot pull a new container image or call an external API) until
  AWS restores capacity. This is an accepted risk, not an oversight,
  because it does not affect the availability property actually
  required: inbound serving capability (ALB routing to healthy Fargate
  tasks in the surviving AZ, plus RDS Multi-AZ failover) does not
  depend on the NAT Gateway at all — NAT only affects outbound traffic
  initiated from the private subnets. If a future requirement adds
  "must keep deploying/patching during a full AZ outage," this becomes
  the first thing to revisit (add a second NAT Gateway, one per AZ).
- **Chose ALB across both AZs (non-negotiable) over a single-AZ ALB**
  regardless of budget posture — an ALB is one billed resource
  regardless of how many AZ subnets it's registered in, so there is no
  cost trade-off here to make; skipping the second AZ registration
  would silently violate the HA requirement for zero savings.

### Cost Optimization (AWS Well-Architected)

- **Fargate over EC2 ASG** (see Topology Decision above) — pay-per-task
  billing avoids paying for idle reserved capacity at this traffic
  profile, and removes the ops overhead (patch cadence, AMI pipeline)
  that has a real cost even when it isn't a line item on the AWS bill.
- **Standard RDS Multi-AZ over Aurora** (see Topology Decision above) —
  lower baseline instance and storage cost for a workload with no
  stated read-scaling need.
- **Single NAT Gateway over per-AZ NAT Gateways** — halves the fixed
  monthly NAT cost plus per-GB data processing charges; the accepted
  availability trade-off is documented above under Reliability so it
  isn't silently lost.
- **No CloudFront / no multi-region standby** — `constraints.yaml`
  explicitly scopes availability to "HA within one region," not global
  latency or multi-region DR, so neither was added. Adding either now
  would be spending against a requirement that doesn't exist yet;
  revisit if traffic becomes geographically distributed or a
  multi-region RTO/RPO requirement is added later.

### Other pillars touched (not the two required, but relevant)

- **Security**: RDS and Fargate tasks sit in private subnets with no
  route to the Internet Gateway for inbound traffic; only the ALB's
  security group may reach the Fargate tasks' security group, and only
  the Fargate tasks' security group may reach RDS's security group on
  5432. DB credentials live in Secrets Manager, not environment
  variables baked into the task definition.
- **Operational Excellence**: Fargate removes host-level patching from
  the team's workload; RDS Multi-AZ failover is automatic (no manual
  runbook step required to restore the database tier).

## What this design explicitly does not cover

Per `constraints.yaml`: no compliance control set was designed against
(none stated), no multi-region failover, no read replicas, and no cost
estimate/dollar figure — the budget posture here is qualitative
("cheaper managed option, no over-provisioned redundancy"), reflected in
the trade-offs above rather than a pricing calculation.
