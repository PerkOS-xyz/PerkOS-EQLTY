# Development plan

This is a living plan for the EQLTY product. It will evolve as each milestone
is implemented and tested.

## Product goal

Build a two minute autonomous workflow where a user states an investment goal,
four specialized agents compare supported stock tokens, and a bounded trade
can be executed with a clear evidence trail.

## Milestones

### 1. Project foundation

- [x] Define the main package boundaries.
- [x] Add repository and package safety rules.
- [x] Document the product roles and sponsor focus.
- [x] Add shared workspace commands.

### 2. User experience

- [x] Create the responsive application shell.
- [x] Add a single wallet access flow.
- [x] Present the supported Robinhood stock token universe.
- [x] Show the four agent roles and their live runtime state.
- [x] Explain recommendation, policy and execution status in plain language.

### 3. Market workflow

- [x] Discover eligible stock tokens through Uniswap.
- [x] Compare candidates against the user objective.
- [x] Reject assets that fail availability or liquidity requirements.
- [x] Produce a recommendation with source timestamps.

### 4. Agent fleet

- [x] Provision or wake one Hermes fleet per authenticated user.
- [x] Give each role only the capabilities it needs.
- [x] Route spending through the user-owned 1Claw Trader rail.
- [x] Display creation, provisioning and wake progress.

### 5. Policy control

- [x] Resolve agent behavior settings from ENS records.
- [x] Show current settings on each agent card.
- [x] Provide clear policy presets for the demonstration.
- [x] Stop the workflow immediately when the fleet is paused.

### 6. Execution and evidence

- [x] Request and review an executable Uniswap quote.
- [x] Enforce contract and spending limits before execution.
- [x] Record the resulting transaction and explorer link.
- [x] Expose indexed event, block and evidence links.
- [x] Index transaction evidence with The Graph Substreams.
- [x] Reconcile the proof bundle through the Auditor role.

### 7. Owner control

- [x] Require the authenticated owner wallet for settings changes.
- [x] Keep wallet challenges and private signing material out of the public API.

### 8. Graph operations

- [x] Expose adapter checkpoint, lag and recovery state.
- [x] Retry failed streams with controlled backoff.
- [x] Explain fail-closed Graph status in the application.
- [x] Restore production provider quota.
- [x] Verify production catch-up within the configured lag limit.

### 9. Demonstration readiness

- [x] Complete a controlled end to end trade.
- [x] Verify the experience on mobile and desktop.
- [x] Prepare a repeatable two minute goal run.
- [x] Document live contract and transaction references.

## Quality gates

Every milestone should include:

- focused tests for new behavior;
- type and build checks for affected packages;
- a review for secrets and unsafe configuration;
- responsive checks for user facing changes;
- explicit handling of unavailable external services.
