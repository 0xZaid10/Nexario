import {
  sqliteTable,
  text,
  integer,
  real,
  index,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core'
import { sql } from 'drizzle-orm'

// ─── tasks ────────────────────────────────────────────────────────────────────

export const tasks = sqliteTable(
  'tasks',
  {
    taskId: text('task_id').primaryKey(),
    userMessage: text('user_message').notNull(),
    userAddress: text('user_address').notNull(),
    chainId: integer('chain_id').notNull(),
    source: text('source', { enum: ['web', 'telegram', 'api'] }).notNull(),
    telegramChatId: integer('telegram_chat_id'),
    status: text('status', {
      enum: ['queued', 'planning', 'executing', 'synthesizing', 'completed', 'failed'],
    })
      .notNull()
      .default('queued'),
    plan: text('plan', { mode: 'json' }),
    result: text('result', { mode: 'json' }),
    error: text('error'),
    permissionsContext: text('permissions_context').notNull(),
    delegationManager: text('delegation_manager').notNull(),
    totalSpentUsdc: text('total_spent_usdc').default('0'),
    createdAt: integer('created_at')
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer('updated_at')
      .notNull()
      .default(sql`(unixepoch())`),
    completedAt: integer('completed_at'),
  },
  (t) => ({
    userAddressIdx: index('tasks_user_address_idx').on(t.userAddress),
    statusIdx: index('tasks_status_idx').on(t.status),
    createdAtIdx: index('tasks_created_at_idx').on(t.createdAt),
    userStatusIdx: index('tasks_user_status_idx').on(t.userAddress, t.status),
  })
)

// ─── subTasks ─────────────────────────────────────────────────────────────────

export const subTasks = sqliteTable(
  'sub_tasks',
  {
    subTaskId: text('sub_task_id').primaryKey(),
    taskId: text('task_id')
      .notNull()
      .references(() => tasks.taskId, { onDelete: 'cascade' }),
    agentName: text('agent_name', {
      enum: ['coordinator', 'research', 'audit', 'report'],
    }).notNull(),
    capability: text('capability').notNull(),
    input: text('input', { mode: 'json' }).notNull(),
    output: text('output', { mode: 'json' }),
    status: text('status', {
      enum: ['queued', 'planning', 'executing', 'synthesizing', 'completed', 'failed'],
    })
      .notNull()
      .default('queued'),
    budgetUsdc: text('budget_usdc').notNull(),
    error: text('error'),
    startedAt: integer('started_at'),
    completedAt: integer('completed_at'),
  },
  (t) => ({
    taskIdIdx: index('sub_tasks_task_id_idx').on(t.taskId),
  })
)

// ─── delegationSteps ──────────────────────────────────────────────────────────

export const delegationSteps = sqliteTable(
  'delegation_steps',
  {
    stepId: text('step_id').primaryKey(),
    taskId: text('task_id')
      .notNull()
      .references(() => tasks.taskId, { onDelete: 'cascade' }),
    subTaskId: text('sub_task_id').references(() => subTasks.subTaskId),
    agentName: text('agent_name').notNull(),
    agentAddress: text('agent_address').notNull(),
    parentStepId: text('parent_step_id'),
    delegation: text('delegation', { mode: 'json' }).notNull(),
    permissionContext: text('permission_context').notNull(),
    oneShotTaskId: text('oneshot_task_id'),
    txHash: text('tx_hash'),
    blockNumber: text('block_number'),
    status: text('status', {
      enum: ['pending', 'submitted', 'confirmed', 'rejected', 'reverted'],
    })
      .notNull()
      .default('pending'),
    budgetAllocated: text('budget_allocated').notNull(),
    budgetUsed: text('budget_used').default('0'),
    chainId: integer('chain_id').notNull(),
    explorerUrl: text('explorer_url'),
    createdAt: integer('created_at')
      .notNull()
      .default(sql`(unixepoch())`),
    confirmedAt: integer('confirmed_at'),
  },
  (t) => ({
    taskIdIdx: index('delegation_steps_task_id_idx').on(t.taskId),
    oneShotTaskIdIdx: index('delegation_steps_oneshot_idx').on(t.oneShotTaskId),
    txHashIdx: index('delegation_steps_tx_hash_idx').on(t.txHash),
    statusIdx: index('delegation_steps_status_idx').on(t.status),
  })
)

// ─── agents ───────────────────────────────────────────────────────────────────

export const agents = sqliteTable(
  'agents',
  {
    agentId: integer('agent_id').primaryKey(),
    owner: text('owner').notNull(),
    wallet: text('wallet').notNull(),
    agentUri: text('agent_uri').notNull(),
    registration: text('registration', { mode: 'json' }).notNull(),
    chainId: integer('chain_id').notNull(),
    capabilities: text('capabilities', { mode: 'json' }).notNull().default('[]'),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    isDemo: integer('is_demo', { mode: 'boolean' }).notNull().default(false),
    registeredAt: integer('registered_at').notNull(),
    lastSeen: integer('last_seen').notNull(),
    totalRevenue: real('total_revenue').notNull().default(0),
    successRate: real('success_rate').notNull().default(0),
    taskCount: integer('task_count').notNull().default(0),
    reputationScore: real('reputation_score').notNull().default(0),
  },
  (t) => ({
    chainIdx: index('agents_chain_idx').on(t.chainId),
    ownerIdx: index('agents_owner_idx').on(t.owner),
    activeIdx: index('agents_active_idx').on(t.isActive),
  })
)

// ─── reputationTags ───────────────────────────────────────────────────────────

export const reputationTags = sqliteTable(
  'reputation_tags',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    agentId: integer('agent_id')
      .notNull()
      .references(() => agents.agentId),
    taskId: text('task_id').references(() => tasks.taskId),
    clientAddress: text('client_address').notNull(),
    feedbackIndex: text('feedback_index'),
    tag1: text('tag1').notNull(),
    tag2: text('tag2'),
    value: text('value').notNull(),
    valueDecimals: integer('value_decimals').notNull().default(0),
    isRevoked: integer('is_revoked', { mode: 'boolean' }).notNull().default(false),
    txHash: text('tx_hash'),
    blockNumber: text('block_number'),
    onChain: integer('on_chain', { mode: 'boolean' }).notNull().default(false),
    createdAt: integer('created_at')
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => ({
    agentTagIdx: index('rep_tags_agent_tag_idx').on(t.agentId, t.tag1),
    agentTag2Idx: index('rep_tags_agent_tag2_idx').on(t.agentId, t.tag1, t.tag2),
    clientIdx: index('rep_tags_client_idx').on(t.clientAddress),
    taskIdx: index('rep_tags_task_idx').on(t.taskId),
  })
)

// ─── oneShotTasks ─────────────────────────────────────────────────────────────

export const oneShotTasks = sqliteTable(
  'oneshot_tasks',
  {
    oneShotTaskId: text('oneshot_task_id').primaryKey(),
    delegationStepId: text('delegation_step_id')
      .notNull()
      .references(() => delegationSteps.stepId),
    taskId: text('task_id')
      .notNull()
      .references(() => tasks.taskId),
    userAddress: text('user_address').notNull(),
    chainId: integer('chain_id').notNull(),
    status: text('status').notNull().default('Pending'),
    txHash: text('tx_hash'),
    blockNumber: text('block_number'),
    memo: text('memo'),
    webhookReceived: integer('webhook_received', { mode: 'boolean' })
      .notNull()
      .default(false),
    webhookPayload: text('webhook_payload', { mode: 'json' }),
    createdAt: integer('created_at')
      .notNull()
      .default(sql`(unixepoch())`),
    confirmedAt: integer('confirmed_at'),
  },
  (t) => ({
    taskIdIdx: index('oneshot_tasks_task_id_idx').on(t.taskId),
    statusIdx: index('oneshot_tasks_status_idx').on(t.status),
    userAddressIdx: index('oneshot_tasks_user_idx').on(t.userAddress),
  })
)

// ─── sseEvents ────────────────────────────────────────────────────────────────
// Buffered events so SSE clients reconnecting can replay missed events.
// userAddress included so the API layer can verify ownership before streaming.

export const sseEvents = sqliteTable(
  'sse_events',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    taskId: text('task_id')
      .notNull()
      .references(() => tasks.taskId, { onDelete: 'cascade' }),
    userAddress: text('user_address').notNull(),
    eventType: text('event_type').notNull(),
    data: text('data', { mode: 'json' }).notNull(),
    createdAt: integer('created_at')
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => ({
    taskIdIdx: index('sse_events_task_id_idx').on(t.taskId),
    userAddressIdx: index('sse_events_user_idx').on(t.userAddress),
    createdAtIdx: index('sse_events_created_at_idx').on(t.createdAt),
  })
)

// ─── sessions ─────────────────────────────────────────────────────────────────
// Each chat has its own session with its own budget + agent requirements.

export const sessions = sqliteTable(
  'sessions',
  {
    sessionId: text('session_id').primaryKey(),
    userAddress: text('user_address').notNull(),
    chainId: integer('chain_id').notNull(),
    chatId: text('chat_id'),           // which chat owns this session
    chatName: text('chat_name'),       // user-defined name e.g. "ETH dip buyer"
    permissionsContext: text('permissions_context').notNull(),
    delegationManager: text('delegation_manager').notNull(),
    budgetUsdc: text('budget_usdc').notNull(),
    spentUsdc: text('spent_usdc').notNull().default('0'),
    allowedActions: text('allowed_actions', { mode: 'json' }).notNull(),
    expiresAt: integer('expires_at').notNull(),
    isRevoked: integer('is_revoked', { mode: 'boolean' }).notNull().default(false),
    agentRequirements: text('agent_requirements', { mode: 'json' }).$type<Record<string, {
      minReputation?: number
      minRevenue?: number
      maxBudget?: number
      requiredTrust?: string[]
    }>>(),
    veniceQualityOracle: integer('venice_quality_oracle', { mode: 'boolean' }).default(false),
    createdAt: integer('created_at')
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => ({
    userChainIdx: index('sessions_user_chain_idx').on(t.userAddress, t.chainId),
    chatIdx: index('sessions_chat_idx').on(t.chatId),
    expiresAtIdx: index('sessions_expires_at_idx').on(t.expiresAt),
    activeIdx: index('sessions_active_idx').on(
      t.userAddress,
      t.chainId,
      t.isRevoked,
      t.expiresAt
    ),
  })
)

// ─── chatThreads ──────────────────────────────────────────────────────────────
// Each chat is an independent context with its own session, budget, and agents.

export const chatThreads = sqliteTable(
  'chat_threads',
  {
    chatId: text('chat_id').primaryKey(),
    userAddress: text('user_address').notNull(),
    name: text('name').notNull().default('New Chat'),
    description: text('description'),
    sessionId: text('session_id'),     // FK to sessions — null until authorized
    status: text('status', {
      enum: ['active', 'expired', 'archived'],
    }).notNull().default('active'),
    messageCount: integer('message_count').notNull().default(0),
    lastMessageAt: integer('last_message_at'),
    createdAt: integer('created_at').notNull().default(sql`(unixepoch())`),
    updatedAt: integer('updated_at').notNull().default(sql`(unixepoch())`),
  },
  (t) => ({
    userIdx: index('chat_threads_user_idx').on(t.userAddress),
    updatedIdx: index('chat_threads_updated_idx').on(t.updatedAt),
  }))

// ─── userMemory ───────────────────────────────────────────────────────────────

export const userMemory = sqliteTable(
  'user_memory',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userAddress: text('user_address').notNull(),
    memoryKey: text('memory_key').notNull(),
    memoryValue: text('memory_value').notNull(),
    category: text('category', {
      enum: ['preference', 'fact', 'decision', 'watchlist', 'risk'],
    }).notNull().default('fact'),
    isPrivate: integer('is_private').notNull().default(0),
    createdAt: integer('created_at')
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer('updated_at')
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => ({
    userKeyIdx: uniqueIndex('user_memory_user_key_idx').on(t.userAddress, t.memoryKey),
    userAddressIdx: index('user_memory_user_idx').on(t.userAddress),
  })
)

// ─── scheduledTasks ───────────────────────────────────────────────────────────

export const scheduledTasks = sqliteTable(
  'scheduled_tasks',
  {
    id:            text('id').primaryKey(),
    userAddress:   text('user_address').notNull(),
    sessionId:     text('session_id').notNull(),
    name:          text('name').notNull(),
    prompt:        text('prompt').notNull(),
    schedule:      text('schedule').notNull(), // cron expression or "interval:N:unit"
    timezone:      text('timezone').notNull().default('UTC'),
    enabled:       integer('enabled').notNull().default(1),
    runCount:      integer('run_count').notNull().default(0),
    lastRunAt:     integer('last_run_at'),
    nextRunAt:     integer('next_run_at').notNull(),
    lastTaskId:    text('last_task_id'),
    lastResult:    text('last_result'),
    permissionsContext: text('permissions_context').notNull(),
    delegationManager:  text('delegation_manager').notNull(),
    createdAt:     integer('created_at').notNull().default(sql`(unixepoch())`),
    updatedAt:     integer('updated_at').notNull().default(sql`(unixepoch())`),
  },
  (t) => ({
    userIdx:   index('scheduled_tasks_user_idx').on(t.userAddress),
    nextRunIdx: index('scheduled_tasks_next_run_idx').on(t.nextRunAt),
  })
)

// ─── chatMessages ─────────────────────────────────────────────────────────────
// Persists full chat thread per user session

export const chatMessages = sqliteTable(
  'chat_messages',
  {
    id:          text('id').primaryKey(),
    userAddress: text('user_address').notNull(),
    sessionId:   text('session_id').notNull(),
    type:        text('type', {
      enum: ['user', 'agent', 'autonomous', 'system'],
    }).notNull(),
    content:     text('content').notNull(),
    taskId:      text('task_id'),
    scheduledBy: text('scheduled_by'),   // scheduled task name
    triggeredBy: text('triggered_by'),   // condition that fired
    isPrivate:   integer('is_private').notNull().default(0),
    audioUrl:    text('audio_url'),
    metadata:    text('metadata'),       // JSON
    createdAt:   integer('created_at').notNull().default(sql`(unixepoch())`),
  },
  (t) => ({
    userSessionIdx: index('chat_messages_user_session_idx').on(t.userAddress, t.sessionId),
    taskIdx:        index('chat_messages_task_idx').on(t.taskId),
  })
)

// ─── Inferred types ───────────────────────────────────────────────────────────

export type Task = typeof tasks.$inferSelect
export type NewTask = typeof tasks.$inferInsert
export type SubTask = typeof subTasks.$inferSelect
export type NewSubTask = typeof subTasks.$inferInsert
export type DelegationStep = typeof delegationSteps.$inferSelect
export type NewDelegationStep = typeof delegationSteps.$inferInsert
export type Agent = typeof agents.$inferSelect
export type NewAgent = typeof agents.$inferInsert
export type ReputationTag = typeof reputationTags.$inferSelect
export type NewReputationTag = typeof reputationTags.$inferInsert
export type OneShotTask = typeof oneShotTasks.$inferSelect
export type NewOneShotTask = typeof oneShotTasks.$inferInsert
export type SseEvent = typeof sseEvents.$inferSelect
export type NewSseEvent = typeof sseEvents.$inferInsert
export type Session = typeof sessions.$inferSelect
export type NewSession = typeof sessions.$inferInsert
export type ChatThread = typeof chatThreads.$inferSelect
export type NewChatThread = typeof chatThreads.$inferInsert
export type UserMemory = typeof userMemory.$inferSelect
export type NewUserMemory = typeof userMemory.$inferInsert
export type ScheduledTask = typeof scheduledTasks.$inferSelect
export type NewScheduledTask = typeof scheduledTasks.$inferInsert
export type ChatMessage = typeof chatMessages.$inferSelect
export type NewChatMessage = typeof chatMessages.$inferInsert
