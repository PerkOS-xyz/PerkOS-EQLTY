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
- [ ] Add shared workspace commands.

### 2. User experience

- [ ] Create the responsive application shell.
- [ ] Add a single wallet access flow.
- [ ] Present the supported Robinhood stock token universe.
- [ ] Show the four agent roles and their live runtime state.
- [ ] Explain recommendation, policy and execution status in plain language.

### 3. Market workflow

- [ ] Discover eligible stock tokens through Uniswap.
- [ ] Compare candidates against the user objective.
- [ ] Reject assets that fail availability or liquidity requirements.
- [ ] Produce a recommendation with source timestamps.

### 4. Agent fleet

- [ ] Provision or wake one Hermes fleet per authenticated user.
- [ ] Give each role only the capabilities it needs.
- [ ] Apply independent 1Claw controls to agent activity.
- [ ] Display creation, provisioning and wake progress.

### 5. Policy control

- [ ] Resolve agent behavior settings from ENS records.
- [ ] Show current settings on each agent card.
- [ ] Provide clear policy presets for the demonstration.
- [ ] Stop the workflow immediately when the fleet is paused.

### 6. Execution and evidence

- [ ] Request and review an executable Uniswap quote.
- [ ] Enforce contract and spending limits before execution.
- [ ] Record the resulting transaction and explorer link.
- [ ] Index transaction evidence with The Graph Substreams.
- [ ] Reconcile the final receipt through the Auditor role.

### 7. Human authorization

- [ ] Add Selfie Check during onboarding.
- [ ] Bind settings changes to the enrolled controller.
- [ ] Keep biometric images and private proof material out of the application
  database.

### 8. Demonstration readiness

- [ ] Complete a controlled end to end trade.
- [ ] Verify the experience on mobile and desktop.
- [ ] Prepare a repeatable two minute goal run.
- [ ] Document live contract and transaction references.

## Quality gates

Every milestone should include:

- focused tests for new behavior;
- type and build checks for affected packages;
- a review for secrets and unsafe configuration;
- responsive checks for user facing changes;
- explicit handling of unavailable external services.
