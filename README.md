# Nexario — Authority Leasing Infrastructure for Autonomous AI Agents
### *(Yes, it's just ERC-7710 redelegation. We gave it a fancier name because "delegation chain depth 3" doesn't fit on a pitch deck.)*

> **MetaMask Smart Accounts Kit × 1Shot API × Venice AI Hackathon**

Nexario is an on-chain agent orchestration platform. Users sign once with MetaMask Flask, delegating a capped USDC budget to a coordinator that dispatches up to 10 specialized AI agents — each powered by Venice AI, paying their own fees, relaying real transactions on Base, and writing reputation scores on-chain. Zero ETH. Zero extra popups. Full auditability.

---

## Index

1. [Code Usage Links](#smart-accounts-kit--code-references) — Smart Accounts Kit, 1Shot API, Venice AI
2. [About Nexario](#what-problem-does-nexario-solve) — What it is, how it works, live deployment *(recommended: read fully to understand integrations)*
3. [Technical Details](#powered-by-1shot-api) — 1Shot, DEX Swaps, Real-Time Monitor, Scheduled Tasks, x402
4. [Feedback & Reflections](#feedback--reflections) — Honest DX feedback per sponsor + suggestions
5. [Roadmap](#roadmap) — Near-term and later

---

## Smart Accounts Kit — Code References

### Advanced Permissions (ERC-7715)

| Usage | File |
|-------|------|
| Request Advanced Permissions (`wallet_grantPermissions`) | [`src/lib/delegation/authorize.ts`](src/lib/delegation/authorize.ts) |
| Extract `context` field from Flask response | [`src/lib/delegation/authorize.ts`](src/lib/delegation/authorize.ts) |
| Session creation + storage (permissionsContext → SQLite) | [`src/sdk/authorize.ts`](src/sdk/authorize.ts) |
| Redeem Advanced Permissions via 1Shot relay | [`src/lib/oneshot/relay.ts`](src/lib/oneshot/relay.ts) |
| Build ERC-7710 execution bundle from permissionsContext | [`src/services/taskRunner.ts`](src/services/taskRunner.ts) |
| ABI encoding/decoding of delegation structs | [`src/lib/encoding.ts`](src/lib/encoding.ts) |
| EIP-712 signing for delegation objects | [`src/lib/signature.ts`](src/lib/signature.ts) |
| DelegationManager + contract addresses config | [`src/config/contracts.ts`](src/config/contracts.ts) |

### Delegations (ERC-7710)

| Usage | File |
|-------|------|
| Create sub-delegation from root permissionsContext | [`src/lib/delegation/build.ts`](src/lib/delegation/build.ts) |
| Delegation index — exports authorize + build | [`src/lib/delegation/index.ts`](src/lib/delegation/index.ts) |
| Redeem delegation — submit to 1Shot relay | [`src/lib/oneshot/relay.ts`](src/lib/oneshot/relay.ts) |
| Track delegation chain depth + caveat compliance | [`src/services/delegationTracker.ts`](src/services/delegationTracker.ts) |
| On-chain authority lease creation/consumption | [`src/services/leaseRegistry.ts`](src/services/leaseRegistry.ts) |
| AuthorityLeaseRegistry smart contract | [`contracts/src/AuthorityLeaseRegistry.sol`](contracts/src/AuthorityLeaseRegistry.sol) |
| Caveat enforcer interfaces | [`contracts/src/caveats/Caveats.sol`](contracts/src/caveats/Caveats.sol) |
| ICaveatEnforcer interface | [`contracts/src/interfaces/ICaveatEnforcer.sol`](contracts/src/interfaces/ICaveatEnforcer.sol) |

### Redelegation

| Usage | File |
|-------|------|
| Coordinator → sub-agent redelegation (ERC-7710 chain) | [`src/agents/coordinator.ts`](src/agents/coordinator.ts) |
| Sub-delegation builder with scoped caveats | [`src/lib/delegation/build.ts`](src/lib/delegation/build.ts) |
| Per-agent delegation tracking across pipeline | [`src/services/delegationTracker.ts`](src/services/delegationTracker.ts) |
| Delegation flow integration test | [`scripts/testDelegationFlow.ts`](scripts/testDelegationFlow.ts) | |

### x402

| Usage | File |
|-------|------|
| x402 paywall server — HTTP 402 response with payment headers | [`src/api/routes/agents.ts`](src/api/routes/agents.ts) |
| x402 payment verification + proof header parsing | [`src/lib/x402/agentPayment.ts`](src/lib/x402/agentPayment.ts) |
| x402+1Shot asset transfer — Venice inference top-up | [`src/lib/venice/x402.ts`](src/lib/venice/x402.ts) |
| x402 ERC-7710 client payment flow in pipeline | [`src/services/taskRunner.ts`](src/services/taskRunner.ts) |
| Payment gating integration test | [`scripts/testPaymentGating.ts`](scripts/testPaymentGating.ts) |

---

## 1Shot API — Code References

| Usage | File |
|-------|------|
| `relayer_getCapabilities` — chain + token discovery | [`src/lib/oneshot/capabilities.ts`](src/lib/oneshot/capabilities.ts) |
| `relayer_getFeeData` — quote relay fee | [`src/lib/oneshot/capabilities.ts`](src/lib/oneshot/capabilities.ts) |
| `relayer_estimate7710Transaction` — pre-flight bundle simulation | [`src/lib/oneshot/estimate.ts`](src/lib/oneshot/estimate.ts) |
| `relayer_send7710Transaction` — submit ERC-7710 bundle | [`src/lib/oneshot/relay.ts`](src/lib/oneshot/relay.ts) |
| `relayer_getStatus` — resolve on-chain tx hash (polling fallback) | [`src/lib/oneshot/status.ts`](src/lib/oneshot/status.ts) |
| Webhook receiver — real-time `type:0/4` callbacks from 1Shot | [`src/lib/oneshot/webhook.ts`](src/lib/oneshot/webhook.ts) |
| Webhook route — `POST /api/webhook/oneshot` | [`src/api/routes/routes.ts`](src/api/routes/routes.ts) |
| EIP-7702 upgrade helpers for 1Shot relay | [`src/lib/oneshot/upgrade.ts`](src/lib/oneshot/upgrade.ts) |
| 1Shot index — barrel export | [`src/lib/oneshot/index.ts`](src/lib/oneshot/index.ts) |
| 1Shot relayer config (URL, methods, chain config) | [`src/config/oneshot.ts`](src/config/oneshot.ts) |
| Full task orchestration — 1Shot per agent per step | [`src/services/taskRunner.ts`](src/services/taskRunner.ts) |
| Reputation writes using 1Shot tx hash as feedbackHash | [`src/services/reputationWriter.ts`](src/services/reputationWriter.ts) |
| End-to-end task runner test script | [`scripts/runFullTask.ts`](scripts/runFullTask.ts) |

---

## Venice AI — Code References

| Usage | File |
|-------|------|
| Venice HTTP client + retry logic | [`src/lib/venice/client.ts`](src/lib/venice/client.ts) |
| Venice chat completions + streaming + JSON mode | [`src/lib/venice/chat.ts`](src/lib/venice/chat.ts) |
| Venice model registry (8 model families, TEE flags) | [`src/lib/venice/models.ts`](src/lib/venice/models.ts) |
| Venice TTS audio generation (`af_heart` voice, MP3) | [`src/lib/venice/media.ts`](src/lib/venice/media.ts) |
| Venice TEE agent client — TEE routing + web search | [`src/lib/venice/agentClient.ts`](src/lib/venice/agentClient.ts) |
| Venice RPC utilities | [`src/lib/venice/rpc.ts`](src/lib/venice/rpc.ts) |
| Venice index — barrel export | [`src/lib/venice/index.ts`](src/lib/venice/index.ts) |
| Venice model config (model IDs per agent) | [`src/config/venice.ts`](src/config/venice.ts) |
| Venice quality oracle → on-chain reputation writes | [`src/lib/venice/qualityOracle.ts`](src/lib/venice/qualityOracle.ts) |
| Venice x402 inference billing top-up | [`src/lib/venice/x402.ts`](src/lib/venice/x402.ts) |
| Privacy classifier — Venice-powered TEE routing | [`src/lib/privacy/classifier.ts`](src/lib/privacy/classifier.ts) |
| Privacy context — task memory + extraction | [`src/lib/privacy/context.ts`](src/lib/privacy/context.ts) |
| Venice Qwen3 235B — Coordinator planning + synthesis | [`src/agents/coordinator.ts`](src/agents/coordinator.ts) |
| Venice Qwen3 235B Thinking — Audit extended reasoning | [`src/agents/audit.ts`](src/agents/audit.ts) |
| Venice Kimi K2.6 + web search — Research | [`src/agents/research.ts`](src/agents/research.ts) |
| Venice Kimi K2.5 + TTS — Report synthesis + audio | [`src/agents/report.ts`](src/agents/report.ts) |
| Venice Qwen3 6.35B TEE — Counsel (legal/compliance) | [`src/agents/counsel.ts`](src/agents/counsel.ts) |
| Venice Qwen3 6.35B TEE — Intelligence (competitive) | [`src/agents/intelligence.ts`](src/agents/intelligence.ts) |
| Venice Gemma 4 26B TEE Uncensored — Reflection | [`src/agents/reflection.ts`](src/agents/reflection.ts) |
| Venice Kimi K2.6 + web search — Reputation scoring | [`src/agents/reputation.ts`](src/agents/reputation.ts) |
| Venice Qwen3 5.9B — Monitor condition parsing | [`src/agents/monitor.ts`](src/agents/monitor.ts) |

---

## Project Structure

```
nexario/
├── .env.example
├── drizzle.config.ts
├── package.json
├── contracts/
│   ├── deployments/base.json
│   ├── scripts/
│   │   ├── deploy.ts
│   │   └── registerAgents.ts
│   └── src/
│       ├── AuthorityLeaseRegistry.sol
│       ├── caveats/Caveats.sol
│       ├── interfaces/
│       │   ├── ICaveatEnforcer.sol
│       │   └── IERC8004.sol
│       └── registry/
│           ├── AgentRegistry.sol
│           └── ReputationRegistry.sol
├── scripts/
│   ├── runFullTask.ts
│   ├── testDelegationFlow.ts
│   └── testPaymentGating.ts
├── src/
│   ├── agents/
│   │   ├── coordinator.ts    # Venice Qwen3 235B — planner + synthesizer
│   │   ├── research.ts       # Venice Kimi K2.6 + web search
│   │   ├── audit.ts          # Venice Qwen3 235B Thinking
│   │   ├── report.ts         # Venice Kimi K2.5 + TTS
│   │   ├── executor.ts       # Pure calldata builder (no Venice)
│   │   ├── counsel.ts        # Venice Qwen3 6.35B TEE
│   │   ├── intelligence.ts   # Venice Qwen3 6.35B TEE
│   │   ├── reflection.ts     # Venice Gemma 4 26B TEE Uncensored
│   │   ├── reputation.ts     # Venice Kimi K2.6 + web search
│   │   ├── monitor.ts        # Venice Qwen3 5.9B + Binance WS
│   │   ├── registry.ts       # On-chain agent registry + wallet mapping
│   │   └── wallets.ts        # Agent wallet management
│   ├── api/
│   │   ├── server.ts
│   │   ├── middleware/
│   │   │   ├── auth.ts
│   │   │   └── errors.ts
│   │   └── routes/
│   │       ├── agents.ts     # x402 paywall + agent listing
│   │       ├── routes.ts     # Auth, events, webhook, schedule, chats
│   │       └── tasks.ts      # Task submission + SSE
│   ├── config/
│   │   ├── chains.ts
│   │   ├── contracts.ts
│   │   ├── env.ts
│   │   ├── oneshot.ts
│   │   └── venice.ts
│   ├── db/
│   │   ├── client.ts
│   │   ├── migrate.ts
│   │   └── schema.ts
│   ├── lib/
│   │   ├── delegation/
│   │   │   ├── authorize.ts  # ERC-7715 session creation
│   │   │   ├── build.ts      # ERC-7710 sub-delegation builder
│   │   │   └── index.ts
│   │   ├── oneshot/
│   │   │   ├── capabilities.ts  # relayer_getCapabilities cache
│   │   │   ├── estimate.ts      # relayer_estimate7710Transaction
│   │   │   ├── relay.ts         # relayer_send7710Transaction
│   │   │   ├── status.ts        # relayer_getStatus polling
│   │   │   ├── webhook.ts       # Real-time webhook handler
│   │   │   └── upgrade.ts       # EIP-7702 upgrade helpers
│   │   ├── venice/
│   │   │   ├── client.ts        # HTTP client + SSE streaming
│   │   │   ├── chat.ts          # Chat completions + JSON mode
│   │   │   ├── agentClient.ts   # TEE routing + web search
│   │   │   ├── media.ts         # TTS audio generation
│   │   │   ├── models.ts        # Model registry
│   │   │   ├── qualityOracle.ts # Venice oracle for reputation
│   │   │   └── x402.ts          # Venice x402 inference billing
│   │   ├── privacy/
│   │   │   ├── classifier.ts    # Privacy score + TEE routing
│   │   │   └── context.ts       # Task context + memory
│   │   ├── dex/zeroex.ts        # 0x Permit2 swap integration
│   │   ├── monitor/priceWatcher.ts  # Binance WebSocket
│   │   ├── erc8004/             # Agent registry + reputation reads
│   │   └── x402/agentPayment.ts # x402 paywall builder
│   ├── sdk/
│   │   ├── authorize.ts         # Public SDK authorize handler
│   │   └── publish.ts
│   ├── services/
│   │   ├── taskRunner.ts        # Core orchestration engine
│   │   ├── reputationWriter.ts  # On-chain reputation oracle writes
│   │   ├── delegationTracker.ts # ERC-7710 chain tracking
│   │   ├── leaseRegistry.ts     # AuthorityLeaseRegistry calls
│   │   ├── chatMessages.ts      # Message persistence
│   │   ├── chatThreads.ts       # Chat thread + session linking
│   │   ├── scheduler.ts         # node-cron autonomous tasks
│   │   └── sse.ts               # SSE with replay buffer
│   └── types/
│       ├── agent.ts
│       ├── delegation.ts
│       ├── reputation.ts
│       └── task.ts
└── tests/
    ├── backend.test.ts
    ├── integration.test.ts
    └── setup.ts
```

---

## What Problem Does Nexario Solve?

Today's AI agents can think but can't act. To do anything on-chain — swap tokens, pay for inference, transfer funds — an agent needs either:

- The user's private key (dangerous), or
- A new MetaMask popup for every action (unusable for autonomous tasks)

Nexario solves this with **ERC-7715 + ERC-7710**: the user signs once with MetaMask Flask. That permission becomes a delegation chain that the coordinator and up to 10 sub-agents can redeem — paying for everything in USDC, with zero ETH, zero popups, and a full on-chain audit trail.

---

## Live Deployment

| Contract | Address | Network |
|----------|---------|---------|
| AgentRegistry (ERC-8004) | `0x3a7C05101aC0Bb99e06026855459d376d7906f15` | Base Mainnet |
| ReputationRegistry | `0xDf2Fbb3fa60ebB1214b782697707cEec14Ae4F82` | Base Mainnet |
| AuthorityLeaseRegistry | `0x5D20459A2C49D5Ba7E5aB0389baaAbFe6F58f2a4` | Base Mainnet |
| MetaMask DelegationManager | `0xdb9B1e94B5b69Df7e401DDbedE43491141047dB3` | Base Mainnet |

**Frontend:** `https://app.nexario.buzz`
**Landing:** `https://nexario.buzz`
**Backend API:** `https://api.nexario.buzz`

---

## Core Features

### 1. One Signature, Unlimited Agent Actions
Users authorize a $1–$100 USDC budget via MetaMask Flask ERC-7715. That single signature creates a permission context the entire Nexario agent network can redeem — without any further user interaction. The coordinator can dispatch as many agents as the task requires, each deducting their fee from the delegated budget automatically.

### 2. Up to 10 Specialized AI Agents Per Task — Powered by Venice AI
The coordinator analyzes the request and dynamically selects which agents to dispatch. A complex task can trigger multiple agents in parallel pipelines. Each agent is registered on-chain as an ERC-8004 NFT and powered by a different Venice AI model selected for that agent's specialty:

| Agent | Venice AI Model | Fee | Capability |
|-------|----------------|-----|-----------|
| Coordinator | Venice · Qwen3 235B | $0.05 | Plans multi-agent pipelines, delegates to sub-agents |
| Research | Venice · Kimi K2.6 + Web Search | $0.10 | Live prices, on-chain data, market intel |
| Audit | Venice · Qwen3 235B Thinking | $0.15 | Risk analysis, smart contract review, extended reasoning |
| Report | Venice · Kimi K2.5 + TTS | $0.05 | Executive summaries with audio output |
| Counsel | Venice · Qwen3 6.35B TEE | $0.20 | Legal/compliance — hardware-attested private enclave |
| Intelligence | Venice · Qwen3 6.35B TEE | $0.15 | Competitive research — private enclave, zero retention |
| Reflection | Venice · Gemma 4 26B TEE Uncensored | $0.10 | Personal journaling — private + uncensored |
| Reputation | Venice · Kimi K2.6 | $0.08 | Wallet identity scoring and trust analysis |
| Monitor | Venice · Qwen3 5.9B | $0.05 | Autonomous on-chain condition watchers |
| Executor | Pure Calldata Builder | $0.05 | On-chain transfers and DeFi actions (no Venice) |

### 3. ERC-7710 Redelegation Chain
The coordinator redeems the user's ERC-7715 grant and creates scoped sub-delegations for each agent it dispatches. Each agent redeems its sub-delegation via 1Shot relay — creating a verifiable on-chain chain of authority: user → coordinator → agent → execution.

### 4. x402 Agent Payment Protocol — Paid via 1Shot
Every Nexario agent exposes a standard HTTP 402 paywall. The `X-Payment-Method: x402+1shot` signals that payment flows through 1Shot relay on Base:

```
POST /api/agents/2/call
→ HTTP 402 Payment Required
  X-Payment-Required: true
  X-Payment-Amount: 100000    ($0.10 USDC)
  X-Payment-Method: x402+1shot
  X-Payment-Chain: 8453
  X-Payment-Recipient: 0x837D25DD...
```

External callers pay via 1Shot relay and retry with `X-Payment-Proof` header. The internal coordinator automates this entire cycle — authorize once, agents pay per inference automatically from the delegated budget.

### 5. Gasless Execution via 1Shot — Zero ETH Required
Every agent action goes through 1Shot's ERC-7710 relay. See the dedicated 1Shot section below for full details.

### 6. Venice TEE Private Inference
Sensitive tasks (legal, personal, competitive intel) are automatically routed by the coordinator to Venice hardware-attested secure enclaves:
- Zero data retention — not stored, not logged, not trained on
- Hardware attestation via Venice TEE
- Venice's uncensored Gemma 4 26B TEE model for personal/wellness content
- Venice's Qwen3 6.35B TEE for legal and competitive intelligence
- Coordinator auto-detects sensitive content and routes accordingly — no user configuration needed

### 7. On-Chain Reputation via ERC-8004 — Venice-Powered Oracle
After every task, a Venice-powered oracle writes agent reputation tags to the ReputationRegistry on Base. The 1Shot task ID serves as the `feedbackHash` — proving payment occurred before reputation was written. This system was designed with an open marketplace in mind: any developer will be able to register ERC-8004 agents that integrate with Nexario's reputation and delegation infrastructure *(see Roadmap)*.

Tags written per task:
- `revenues` — cumulative USDC earnings (e.g. Research agent: $300.90 after 15 tasks)
- `successRate` — task completion rate
- `responseTime` — milliseconds per task
- `delegationDepth` — ERC-7710 chain depth
- `caveatCompliance` — caveat enforcement score

Users set minimum reputation thresholds when authorizing — agents below threshold are blocked at the protocol level before any task executes.

### 8. Autonomous Scheduled Tasks
Users schedule recurring tasks (hourly/daily/weekly via cron). The backend scheduler fires tasks using the stored ERC-7715 permissionsContext — even when the user is offline. Results are saved to the chat thread server-side and displayed when the user returns.

### 9. Persistent Sessions Across Browser Reloads
Each chat thread has its own ERC-7715 session, budget, and agent requirements. Sessions persist in the SQLite backend — the permissionsContext is restored from the database on reload, so users never need to re-authorize within the session window.

---

## Powered by 1Shot API

1Shot is the gasless relay layer that makes everything in Nexario possible without ETH. Every on-chain action — agent fee payment, USDC transfer, smart contract call — goes through 1Shot's ERC-7710 relay.

### How 1Shot Powers Nexario

**No ETH for users.** The user delegates USDC spending rights via ERC-7715. 1Shot's relayer accepts those delegated permissions and pays the Base gas fees itself, deducting only USDC from the user's delegated budget. The user never needs ETH in their wallet.

**No ETH for agents.** Agent wallets are pure recipients — they receive USDC fee payments via 1Shot bundles. No gas, no ETH balance required.

**Multi-execution bundles.** Each 1Shot transaction can include multiple executions in a single on-chain tx:
```
executions: [
  transfer(feeCollector, $0.01),     // 1Shot relay fee
  transfer(agentWallet, $0.10),      // Agent fee (e.g. Research)
  transfer(recipient, $0.10),         // Optional: user's intended action
]
```
This means a USDC send to a friend, an agent fee, and a relay fee all land in a single Base transaction — one Basescan entry, one gas cost.

**Cryptographic delegation verification.** 1Shot's relay validates the full ERC-7710 delegation chain on-chain before executing. If the user revokes their session, all future relay attempts fail immediately — no backend changes needed.

### 1Shot API Calls Used

| Method | Purpose |
|--------|---------|
| `relayer_getCapabilities` | Fetch supported chains, tokens, and target addresses |
| `relayer_getFeeData` | Quote relay fee for a given chain + token |
| `relayer_estimate7710Transaction` | Pre-flight cost estimation with execution bundle |
| `relayer_send7710Transaction` | Submit ERC-7710 execution bundle with delegation proof |
| `relayer_getStatus` | Resolve real on-chain tx hash after confirmation (polling fallback) |
| **Webhook callbacks** | 1Shot POSTs real-time status to `https://api.nexario.buzz/api/webhook/oneshot` |

### Live 1Shot Transactions on Base Mainnet

These relay transactions are from real Nexario task executions:

| Tx Hash | Description |
|---------|-------------|
| [`0x5b2df6...79466`](https://basescan.org/tx/0x5b2df6aebfb2d8302c140dc5f3e9322d9b58501a47b7c8fe681c49ca5fb79466) | Multi-agent task — research + audit + report pipeline |
| [`0xf64918...42e49`](https://basescan.org/tx/0xf64918e42c4f1078311338b2e5b1015daaad2250ce1b1c904a680d64e5942e49) | Executor agent — USDC transfer bundled in ERC-7710 relay |
| [`0xe9dff0...8ac7`](https://basescan.org/tx/0xe9dff0f0b27289d45587bb480f2e64178a67aa4f360feaea7835a85606df8ac7) | TEE agents — counsel + intelligence privacy pipeline |
| [`0x9a75c4...3b065`](https://basescan.org/tx/0x9a75c4ab25c5e14e733924a6cf8fb729d4384e46dc07310129f326c34253b065) | Webhook-confirmed relay — type:0 callback received before polling resolved |
| [`0x414821...0972e`](https://basescan.org/tx/0x414821b932d1162a76657d8fb20536db0b4f360873d7c74026a2d9acea30972e) | Audit agent — Uniswap v4 risk analysis pipeline |

---

## DEX Swaps — Built, Blocked by ERC-7715 Caveat Constraint

Nexario has a fully working 0x swap integration. The executor agent fetches live quotes from the 0x Permit2 API on Base, builds swap calldata, and attempts to relay it through 1Shot. The infrastructure is complete:

- `src/lib/dex/zeroex.ts` — 0x Permit2 quote + price API, verified liquid tokens on Base (WETH, cbETH, AERO, BRETT, VIRTUAL, TOSHI, DEGEN)
- `src/agents/executor.ts` — swap parsing, 0x quote fetching, permit2 approval bundling, `buildSwapExecution()`
- Binance WebSocket price monitor triggers swap pipelines autonomously when conditions are met
- Permit2 approval + swap calldata correctly bundled as multi-execution 1Shot transaction

**What blocks it:** The ERC-7715 `erc20-token-periodic` permission type uses the `ERC20PeriodTransferEnforcer` caveat on the MetaMask DelegationManager. This enforcer validates that each execution is exactly a standard ERC-20 `transfer(address,uint256)` call — 68 bytes of calldata. The 0x swap router calldata is several kilobytes. The enforcer rejects it:

```
ERC20PeriodTransferEnforcer:invalid-execution-length
```

**What we tried:**
1. Direct 0x Permit2 quote → 1Shot bundle — rejected by enforcer
2. Bundling permit2 `approve(permit2, maxUint256)` + swap calldata — both rejected
3. Using `value: "0"` vs `value: "0x0"` formatting — not the issue
4. 1Shot `relayer_estimateFee` correctly identifies the failure before submission

**The path forward:** MetaMask Flask ERC-7715 supports a `contract-call` permission type that allows arbitrary calldata to specific contract addresses. Replacing `erc20-token-periodic` with a `contract-call` permission scoped to the 0x router address would allow the swap calldata through. This requires a different `wallet_grantPermissions` call with `contract-call` permission type, 1Shot support for the `contract-call` caveat enforcer, and testing whether MetaMask Flask's current build validates this permission type.

An alternative is a two-step approach: ERC-7710 delegation handles the USDC payment (simple transfer, passes enforcer), and a separate deployer wallet executes the swap and forwards tokens to the user — fully auditable but not purely trustless.

---

## Real-Time Price Monitor — Binance WebSocket + Autonomous Agent Pipelines

Nexario includes a fully working real-time price monitoring system powered by Binance WebSocket streams — not polling. When a user sets a price condition, the monitor agent opens a persistent WebSocket connection to Binance and receives every trade tick in real time. When the price crosses the threshold, the trigger fires instantly.

### How It Works

```
User: "Monitor ETH, alert me when it drops below $1650"
→ Monitor agent parses condition via Venice (Qwen3 coordinator model)
→ getCurrentPrice() fetches live ETH price from Binance REST API
→ addPriceWatch() opens wss://stream.binance.com/ws/ethusdt@trade
→ Every Binance trade pushes price tick to our WS handler
→ Price crosses $1650 → callback fires immediately (sub-second)
→ createTask() spawns full autonomous agent pipeline:
   research → executor → report
→ Results saved to chat_messages, appear in chat when user returns
→ Session uses stored permissionsContext — no user interaction needed
```

### Supported Conditions
- **Price alerts** — any Binance-listed token pair (ETH, BTC, SOL, AERO, BRETT, VIRTUAL, TOSHI, DEGEN, and more)
- **Percentage drops/rises** — "alert when ETH drops 5%" (Venice calculates threshold from current price)
- **Wallet activity** — polls Alchemy Base RPC every 15 minutes for address activity
- **Absolute thresholds** — "alert when ETH goes above $2000"

### Trigger Pipelines
When condition is met, monitor spawns a full coordinator pipeline using stored `permissionsContext` — no user interaction:
- **Alert only** — research + report (market conditions at trigger time)
- **Alert + transfer** — research + executor (USDC transfer to address) + report
- **Alert + swap** — research + executor (0x swap, pending `contract-call` permission) + report

### Why Binance WebSocket (Not Polling)
Polling every 5 minutes misses intraday spikes. Binance `@trade` stream receives every single trade tick at zero cost, no API key required — millisecond precision. For DCA strategies, stop-losses, or time-sensitive DeFi actions, sub-second triggers vs. 5-minute polls is the difference between a filled and a missed order.

### Technical Details
- `src/lib/monitor/priceWatcher.ts` — Binance WS connection manager, condition evaluation, auto-reconnect on disconnect
- `src/agents/monitor.ts` — Venice-powered condition parser, `addPriceWatch()`, `createTask()` trigger
- Watches persist in memory — one WebSocket per token pair, multiple conditions per stream
- Wallet watches stored in `scheduled_tasks` SQLite table, checked every 15 minutes by node-cron

---

## Powered by Venice AI

Venice AI is the inference backbone of Nexario. Every agent (except Executor) runs on Venice — chosen because Venice combines high-quality open-weight models, native web search, hardware-attested TEE enclaves, TTS audio, and an x402 payment protocol in a single API.

### Why Venice for Nexario

**Model diversity for specialized agents.** Nexario uses 8 different Venice model families across 10 agents — each selected for the agent's specific task. The Coordinator uses Qwen3 235B for complex planning. Research uses Kimi K2.6 with Venice's native web search for live data. Audit uses Qwen3 235B in Thinking mode for extended step-by-step reasoning. Reflection uses Venice's uncensored Gemma 4 26B for personal content without filters.

**TEE enclaves for private tasks.** Venice's hardware-attested TEE models (`e2ee-qwen3-6-35b-a3b`, `e2ee-gemma-4-26b-a4b-uncensored-p`) allow Nexario to handle sensitive queries — legal analysis, personal journaling, competitive intelligence — with zero data retention and hardware-level privacy guarantees. No other inference provider offers this combination of quality and TEE attestation.

**TTS for audio summaries.** The Report agent generates voice summaries of every task result using Venice TTS, making Nexario accessible as an audio briefing platform.

**Web search built-in.** Venice's Kimi K2.6 model has native web search, enabling the Research agent to fetch live prices, protocol TVL, gas fees, and market data without external APIs.

### Venice Models Used

| Venice Model | Agent | Notes |
|-------------|-------|-------|
| `qwen3-235b-a22b-instruct-2507` | Coordinator | Task planning, synthesis |
| `kimi-k2-6` | Research, Reputation | Web search enabled |
| `qwen3-235b-a22b-thinking-2507` | Audit | Extended reasoning mode |
| `kimi-k2-5` | Report | Synthesis + TTS output |
| `e2ee-qwen3-6-35b-a3b` | Counsel, Intelligence | Venice TEE — private enclave |
| `e2ee-gemma-4-26b-a4b-uncensored-p` | Reflection | Venice TEE — uncensored |
| `qwen3-5-9b` | Monitor | Lightweight, fast |
| Venice TTS | Report | Audio summary generation |

---

## Standards & Protocols

### ERC-7715 — Permission Grants
Users sign a single ERC-7715 grant in MetaMask Flask authorizing the Nexario coordinator to spend a capped USDC budget over a time window. The `context` field contains the ABI-encoded delegation used by 1Shot.

```javascript
await provider.request({
  method: 'wallet_grantPermissions',
  params: [{
    chainId: '0x2105',  // Base
    address: TARGET_ADDRESS,  // 1Shot target: 0x26a529...
    permissions: [{
      type: 'erc20-token-periodic',
      data: {
        periodAmount: '1000000',  // $1 USDC
        periodDuration: 3600,     // 1 hour
        tokenAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      }
    }],
    expiry: Math.floor(Date.now() / 1000) + 3600,
  }]
})
// Returns: [{ context: '0x...', delegationManager: '0xdb9B...' }]
// The context field IS the ABI-encoded delegation for 1Shot
```

### ERC-7710 — Redelegation
The coordinator redeems the user's ERC-7715 delegation and creates scoped sub-delegations per agent. 1Shot validates the chain cryptographically before executing any transaction. Each relay bundle carries the full delegation proof.

### EIP-7702 — Smart Account Delegation
The MetaMask DelegationManager (`0xdb9B1e94B5b69Df7e401DDbedE43491141047dB3`) is an EIP-7702 stateless delegator that validates permission chains on-chain before allowing execution.

### x402 — HTTP Payment Protocol
All 10 Nexario agents expose standard HTTP 402 paywalls. `X-Payment-Method: x402+1shot` indicates payment via 1Shot relay on Base. External integrations pay any agent with USDC — no ETH, no MetaMask required.

### ERC-8004 — Agent Identity
Each agent is an NFT on Base. The token URI contains capabilities, Venice model ID, TEE status, x402 support, reputation requirements, and A2A service endpoints — fully on-chain discoverable.

---

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                   User (MetaMask Flask)                       │
│   Signs ERC-7715 → permissionsContext (ABI-encoded)          │
│   Budget: $1 USDC / 1 hour / Base mainnet                    │
└───────────────────────────┬──────────────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────────┐
│              Nexario Backend (Node.js 22, Express)            │
│                                                               │
│  ┌──────────────────┐    ┌─────────────────────────────┐    │
│  │   Coordinator    │───▶│  Venice AI · Qwen3 235B      │    │
│  │   ERC-7710 root  │    │  Plans sub-task pipeline     │    │
│  └────────┬─────────┘    └─────────────────────────────┘    │
│           │                                                    │
│  ┌────────┴────────┬──────────┬──────────┬──────────┐       │
│  ▼                 ▼          ▼          ▼          ▼       │
│ Research         Audit      Counsel   Executor    Report    │
│ Venice·Kimi K2.6 Venice·    Venice·   Calldata   Venice·   │
│ + web search     Qwen3 235B Qwen3 TEE builder    Kimi+TTS  │
│  │                 │          │          │          │       │
│  └────────┬────────┴──────────┴──────────┴──────────┘       │
│           ▼                                                    │
│  ┌────────────────┐    ┌──────────────────────────┐         │
│  │  1Shot Relay   │    │  ReputationRegistry       │         │
│  │  ERC-7710      │    │  Venice oracle writes     │         │
│  │  send7710Tx    │    │  feedbackHash = taskId    │         │
│  └───────┬────────┘    └──────────────────────────┘         │
└──────────┼───────────────────────────────────────────────────┘
           │
           ▼
┌──────────────────────────┐
│   Base Mainnet           │
│   USDC transfers         │
│   RedeemDelegations txs  │
│   Basescan confirmed     │
└──────────────────────────┘
```

---

## Getting Started

### Prerequisites
- Node.js 22 (`nvm use 22`)
- MetaMask Flask browser extension (not regular MetaMask — Flask required for ERC-7715)
- Base mainnet USDC in your Flask wallet
- Alchemy or similar Base RPC URL
- Venice AI API key

### Installation

```bash
git clone https://github.com/0xZaid10/nexario
cd nexario
npm install
cd frontend && npm install && cd ..
```

### Environment Setup

```bash
cp .env.example .env
```

Edit `.env`:

```env
# Required
PRIVATE_KEY=0x...                # Deployer/owner wallet
ORACLE_PRIVATE_KEY=0x...         # Oracle wallet (writes reputation on-chain)
BASE_RPC_URL=https://base-mainnet.g.alchemy.com/v2/YOUR_KEY
VENICE_API_KEY=your_venice_api_key

# Optional
DATABASE_URL=./nexario.db        # SQLite path (default: project root)
PORT=3000

# Pre-deployed on Base mainnet — no changes needed
AGENT_REGISTRY_ADDRESS=0x3a7C05101aC0Bb99e06026855459d376d7906f15
REPUTATION_REGISTRY_ADDRESS=0xDf2Fbb3fa60ebB1214b782697707cEec14Ae4F82
```

### Running

```bash
# Terminal 1: Backend API
nvm use 22
npm run dev
# Ready at http://localhost:3000

# Terminal 2: Frontend
cd frontend
npm run dev
# UI at http://localhost:5173
```

All 10 system agents are pre-registered on Base mainnet. Connect MetaMask Flask, click "Authorize Agents", sign the ERC-7715 grant, and start chatting.

---

## API Reference

### Authorization

#### `POST /api/authorize`
Create an ERC-7715 session.

```json
{
  "userAddress": "0x...",
  "permissionsContext": "0x...",
  "budgetUsdc": 1,
  "expiresAt": 1234567890,
  "chatId": "uuid",
  "agentRequirements": {
    "research": { "minReputation": 80, "minRevenue": 0, "maxBudget": 3 },
    "audit":    { "minReputation": 85, "minRevenue": 0, "maxBudget": 4 }
  }
}
```

#### `GET /api/authorize/chats`
List all chat threads with session info (budget remaining, expiry, agent requirements).

#### `GET /api/authorize/chat/messages?sessionId=<chatId>`
Full persisted message history for a chat thread.

### Tasks

#### `POST /api/tasks`
Submit a task to the agent network.

```json
{
  "userMessage": "Analyze legal implications of Aave flash loans in India",
  "chatId": "uuid"
}
```

SSE stream events:
- `status_change` — planning / executing / synthesizing
- `plan_ready` — coordinator's agent pipeline
- `subtask_started` — Venice streaming chunks
- `delegation_confirmed` — 1Shot relay confirmed on-chain
- `task_complete` — final result + tx details + Basescan links
- `error` — task failed

#### `GET /api/events/:taskId`
SSE stream. Auto-replays buffered events for reconnecting clients.

### Agents

#### `GET /api/agents`
All registered agents with live on-chain reputation from Venice oracle.

```json
{
  "agents": [{
    "agentId": 2,
    "name": "Research Agent — Nexario",
    "veniceModel": "kimi-k2-6",
    "isTEE": false,
    "feePerCall": 0.10,
    "reputation": {
      "revenues": 300.90,
      "successRate": 490,
      "responseTime": 71137
    }
  }]
}
```

#### `POST /api/agents/:agentId/call`
**x402-gated** agent endpoint. No payment → `402 Payment Required`:

```
HTTP/1.1 402 Payment Required
X-Payment-Required: true
X-Payment-Amount: 100000
X-Payment-Token: 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
X-Payment-Recipient: 0x837D25DD587d7288c09b868aFC9521df343C1788
X-Payment-Chain: 8453
X-Payment-Method: x402+1shot
```

With `X-Payment-Proof: <1Shot-taskId>` → Venice inference executes, result returned.

### Scheduled Tasks

#### `POST /api/schedule`
```json
{
  "name": "Daily ETH price alert",
  "prompt": "Check ETH price and alert if below $2000",
  "schedule": "0 9 * * *",
  "chatId": "uuid"
}
```

#### `GET /api/schedule` / `DELETE /api/schedule/:taskId`
List or cancel scheduled tasks.

---

## Demo Walkthrough

### 1. Single Signature Authorization
```
Open frontend → New Chat → Authorize Agents
Set budget: $1 USDC | Duration: 1 hour
→ MetaMask Flask: Sign ERC-7715 permission grant
→ permissionsContext stored in backend SQLite
→ Budget bar: $1.00 / expires in 60m
```

### 2. Multi-Agent Research + Legal Task
```
Type: "Analyze legal implications of Aave v3 flash loans for arbitrage in India"

Coordinator (Venice · Qwen3 235B) plans:
  counsel (TEE) → research → audit → report

→ counsel: Venice · Qwen3 6.35B TEE enclave
  1Shot relay: 0x7b43a2fb... ✓ Basescan

→ research: Venice · Kimi K2.6 + web search
  1Shot relay: 0x2beaae5d... ✓ Basescan

→ report: Venice · Kimi K2.5 + TTS
  1Shot relay: 0xe6715744... ✓ Basescan

Result: Full legal analysis + audio summary
Transaction drawer: 3 Basescan links, $0.35 spent
```

### 3. On-Chain USDC Transfer
```
Type: "Send 0.1 USDC to 0x0D8C9C2EA8AaF4d77c0140Ac5E2602f29D7328c3"

Coordinator plans: research → executor

Executor builds 1Shot bundle:
  [relay fee → 1Shot, agent fee → deployer, 0.1 USDC → recipient]

Single Base tx — 3 outputs in one relay
0x0D8C9C2E received 0.1 USDC ✓ Basescan
Total: $0.17 USDC from delegated budget
```

### 4. Budget Enforcement
```
Session has $0.44 remaining
Type: "Send 2 USDC to 0x..."
→ Executor: "Insufficient budget. $2 > $0.44 remaining"
→ No transaction submitted. Delegation caveat enforced.
```

### 5. x402 Agent Call from CLI
```bash
# No payment → 402
curl -X POST http://localhost:3000/api/agents/2/call \
  -H "Content-Type: application/json" \
  -d '{"query": "Current ETH price?"}' -i

HTTP/1.1 402 Payment Required
X-Payment-Amount: 100000
X-Payment-Method: x402+1shot

# Pay via 1Shot, get taskId proof
# Retry with proof
curl -X POST http://localhost:3000/api/agents/2/call \
  -H "X-Payment-Proof: 0x6ee632be..." \
  -d '{"query": "Current ETH price?"}'
# → Venice · Kimi K2.6 research result
```

### 6. Autonomous Scheduled Task
```
Click ⏰ → "Alert me daily if ETH drops below $2000"
→ Cron: 0 9 * * *
→ Backend fires via stored permissionsContext
→ Chat populates even when browser is closed
→ User returns → sees overnight alerts
```

### 7. On-Chain Reputation Check
```bash
cast call 0xDf2Fbb3fa60ebB1214b782697707cEec14Ae4F82 \
  "getSummary(uint256,address[],string,string)(uint64,int128,uint8)" \
  2 "[0x1C280993F1423dc3DC050aFE5bfe5FbBDb7b05c3]" "revenues" "task" \
  --rpc-url https://mainnet.base.org
# → count: 15, value: 30090, decimals: 2 → $300.90 earned
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Smart Accounts | MetaMask Flask, ERC-7715, ERC-7710, EIP-7702 |
| Gasless Relay | 1Shot API (`relayer_getFeeData`, `send7710Transaction`, `relayer_getStatus`) |
| AI Inference | Venice AI (8 model families, TEE enclaves, TTS, web search) |
| Payment Protocol | x402 HTTP + 1Shot as payment rail (`X-Payment-Method: x402+1shot`) |
| Agent Identity | ERC-8004 NFTs on Base mainnet |
| Reputation | Custom ReputationRegistry + Venice-powered oracle |
| Backend | Node.js 22, TypeScript, Express, Drizzle ORM, SQLite |
| Frontend | React 18, Vite, Tailwind CSS, Zustand, wagmi v2, viem |
| Blockchain | viem 2.52, Base mainnet, USDC |
| Scheduling | node-cron, persistent SQLite sessions |

---


## Hackathon Track Integration

### MetaMask Smart Accounts Kit
- `wallet_grantPermissions` → ERC-7715 session with USDC budget caveat
- `context` field extraction → ABI-encoded delegation for 1Shot bundles
- ERC-7710 redelegation → coordinator to per-agent sub-delegations
- EIP-7702 DelegationManager (`0xdb9B...`) → on-chain validation
- MetaMask Flask as the sole signer — one popup, unlimited actions

### 1Shot API
Every task execution uses 1Shot. Full method coverage:
- `relayer_getCapabilities` — supported chains + token addresses
- `relayer_getFeeData` — quote relay fee (always $0.01 USDC on Base)
- `relayer_estimate7710Transaction` — pre-flight bundle cost estimation
- `relayer_send7710Transaction` — submit ERC-7710 execution bundle
- `relayer_getStatus` — resolve real on-chain tx hash post-confirm (polling fallback)
- **Webhook endpoint** — `POST https://api.nexario.buzz/api/webhook/oneshot` receives real-time `type:0` (confirmed) and `type:4` (pending) callbacks from 1Shot relay, parsed and routed to mark delegation steps confirmed before polling resolves

### Venice AI
10 agents, 8 Venice model families:
- Qwen3 235B for planning and audit reasoning
- Kimi K2.6 with Venice web search for live research
- Kimi K2.5 for report synthesis
- Gemma 4 26B TEE Uncensored for personal reflection
- Qwen3 6.35B TEE for counsel and intelligence
- Qwen3 5.9B for lightweight monitoring
- Venice TTS for audio summaries on every report
- Venice TEE attestation for automatic privacy routing

### x402
- All 10 agents: `POST /api/agents/:id/call` returns HTTP 402
- `X-Payment-Method: x402+1shot` — 1Shot as payment rail on Base
- Standard payment headers: amount, token, recipient, chain, method
- Coordinator auto-pays per-agent within the user's delegation budget
- External developers can call any Nexario agent via standard x402

---

---

## Feedback & Reflections

### MetaMask Smart Accounts Kit

**What worked well**

ERC-7715 `wallet_grantPermissions` is genuinely powerful once you understand the exact shape Flask expects. The `erc20-token-periodic` permission type with `ERC20PeriodTransferEnforcer` gave us real cryptographic budget enforcement — not a policy check, an on-chain constraint. The fact that the user's EOA gets smart account capabilities without deploying a new contract or migrating to a new address is a genuinely impressive UX unlock.

**What was hard**

The single most painful discovery: the response from `wallet_grantPermissions` has both a `permissionsContext` field and a `context` field. The actual ABI-encoded delegation is in `context`, not `permissionsContext`. `permissionsContext` contains a different, shorter value that 1Shot silently rejects. We spent hours debugging null address errors in 1Shot bundles before finding this. The docs don't mention this distinction clearly.

The second major issue: ABI decoding the `context` field. The `authority` field in the delegation struct is `bytes32` which viem's `decodeAbiParameters` returns as a bigint. `0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff` (the root authority) is too large for JavaScript's safe integer range and throws `IntegerOutOfRangeError` before the decode completes. We fixed this by converting to hex string before mapping.

The `ERC20PeriodTransferEnforcer` blocking swap calldata was expected once we understood it — the enforcer validates that calldata matches a simple ERC-20 `transfer()` selector. 0x Permit2 swap calldata doesn't match, so the enforcer rejects it before 1Shot even sees the transaction. The fix requires switching to the `contract-call` permission type scoped to the 0x router. We built the full 0x integration, hit the wall, documented it clearly in the README.

The `destinationUrl` field in the 1Shot bundle caused a null address error when `API_BASE_URL` wasn't set in the environment — `localhost:3000` was being passed to 1Shot which then failed address validation internally. Not obvious from the error message.

**Suggestions**

Document `context` vs `permissionsContext` clearly — even a single line in the response shape docs would have saved hours. A note that `authority: 0xffff...ffff` represents root authority (no parent delegation) and that it ABI-encodes as a very large bigint would also help TypeScript builders. A `contract-call` permission type example alongside `erc20-token-periodic` in the quickstart would make the swap use case immediately clear.

---

### 1Shot API

**What worked well**

The permissionless relayer is genuinely remarkable. No signup, no API key, no pre-funded paymaster — just submit a valid ERC-7710 bundle and it executes. `relayer_estimate7710Transaction` is underrated — it catches delegation chain errors, budget exhaustion, and enforcer rejections before any gas is spent, which saved us repeatedly during development. The bundle format (multiple executions in one Base transaction) is elegant: relay fee + agent fee + user action all in a single Basescan entry.

**What was hard**

Webhook signature verification with the public permissionless relayer was impossible — the dashboard provides a public key that doesn't match the signing key used by the relayer. After extensive debugging (trying full rawBody, body without signature, safe-stable-stringify, noble/ed25519, timestamp-prepended variants), we reached out and learned from a 1Shot team member (Charlie Sibbach) that the public relayer uses internal rotating keys not exposed via dashboard — and separately that there was a double-stringify bug in their 1ShotPay verification code that was actively being fixed during our build week. We ended up skipping signature verification for the permissionless relayer and processing all webhooks, trusting HTTPS + format validation instead.

The webhook payload format also changed between what the docs describe and what we actually received. Docs show `{ eventName: 'TransactionExecutionSuccess', data: { transactionReceipt, ... } }` — the real payload is `{ type: 0, data: { id, chainId, receipt, hash } }`. `type: 0` = confirmed, `type: 4` = pending status update. We reverse-engineered this from live payloads.

`relayer_getCapabilities` returns `{}` empty on Base mainnet — the fallback to `relayer_getFeeData` works but the empty capabilities response meant our token address was `null` until the fallback ran. Led to cryptic null address errors that looked like a delegation issue.

**Suggestions**

Document the actual webhook payload shape for the public permissionless relayer — `type: 0/4` format is different from the M2M dev platform format. A note that the permissionless relayer's signing key is internal (not dashboard-configurable) would save builders significant debugging time. A working `relayer_getCapabilities` response on Base mainnet would also help — the empty result is confusing for first-time integrators.

---

### Venice AI

**What worked well**

The model breadth is unmatched for this use case. Having Qwen3 235B Thinking mode, Kimi K2.6 with native web search, TEE enclaves, TTS, and uncensored models all under one API with consistent auth was exactly what a multi-agent system needs. Venice TEE is particularly compelling — hardware attestation as a first-class API feature, not an afterthought. The web search integration directly in inference context (no separate search API call, no rate limit) is the right abstraction for research agents.

**What was hard**

The research agent used stale training data for price queries even with `enableWebSearch: true`. The system prompt had to explicitly say "NEVER use training data for prices, always web search right now" before Venice consistently fetched live data. A more aggressive default toward web search when the query contains temporal signals (current, now, today, price) would improve accuracy significantly.

Venice 429 rate limits hit during multi-agent pipelines where 4-5 agents fire Venice calls in parallel. We added 5x retry with exponential backoff (20s, 40s intervals) in the coordinator and synthesis paths. Not a blocker but adds latency on complex tasks.

The TEE model IDs (`e2ee-qwen3-6-35b-a3b`, `e2ee-gemma-4-26b-a4b-uncensored-p`) aren't listed in the main models documentation — we found them by querying the models endpoint directly. A dedicated TEE models section would help.

**Suggestions**

A temporal signal detector that defaults to web search when queries contain price/current/today/now would make the research agent significantly more useful out of the box. Clearer documentation of TEE model IDs with explicit TEE capability flags in the model listing. A rate limit header in 429 responses indicating retry-after would let clients backoff more precisely instead of fixed exponential delays.

---

### General

Building a multi-agent system that spans ERC-7715, ERC-7710, EIP-7702, ERC-8004, 1Shot relay, Venice inference, and x402 in a single week was ambitious. The three sponsor technologies compose well — Venice provides the intelligence, 1Shot provides the gasless execution rail, and MetaMask Flask provides the cryptographic permission layer. The gaps are at the integration points between them, not within any individual SDK.

## Roadmap

### Near-term
- **DEX swaps via ERC-7715 `contract-call` permission** — Infrastructure fully built (0x integration, permit2 approval bundling, Binance WS trigger). Blocked only by `ERC20PeriodTransferEnforcer` rejecting non-transfer calldata. Switching permission type to `contract-call` scoped to 0x router address unblocks this.
- **MetaMask Agent Wallets integration** — When MetaMask releases Agent Wallets (currently in development), third-party developers will be able to register their own ERC-8004 agents in the Nexario registry. The reputation system, x402 paywall infrastructure, and delegation framework are already built for this. External agents will earn USDC per task, have on-chain reputation written by the Venice oracle, and be discoverable by the Nexario coordinator.
- **Binance WebSocket price alerts → cross-chain swaps** — Monitor infrastructure supports any Binance-listed token pair. Swap execution extends to Arbitrum, Optimism via additional 1Shot chain support.
- **x402 top-up via 1Shot** — Agent Venice balances topped up through 1Shot relay (no ETH for agent operators)
- **Agent-to-Agent delegation** — Deeper ERC-7710 chains, agents spawning sub-agents

### Later
- **User-deployed agent logic** — Upload custom system prompts + Venice model selection
- **Reputation-gated task routing** — Coordinator selects agents based on live on-chain scores
- **USDC yield on idle session budgets** — Aave/Compound integration while budget is unspent
- **Mobile app** — Native iOS/Android with MetaMask SDK

---

## License

MIT

---

## Built By

[@0xZaid10](https://github.com/0xZaid10) — Solo builder
MetaMask Smart Accounts Kit × 1Shot API × Venice AI Hackathon 2026
