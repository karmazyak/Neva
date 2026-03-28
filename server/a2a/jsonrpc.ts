import type {
  JsonRpcRequest, JsonRpcResponse, JsonRpcError, SendMessageParams,
  Task, TaskState, A2AMessage, TaskEvent,
} from './types'
import { JSONRPC_ERRORS } from './types'
import { ExecutionEventBus } from './event-bus'
import type { TaskStore } from './task-store'
import type { NevaAgentExecutor } from './executor'

// ── Helpers ─────────────────────────────────────────────────────────────────

function errorResponse(id: string | number | null, code: number, message: string): JsonRpcResponse {
  return { jsonrpc: '2.0', id, error: { code, message } }
}

function nowISO(): string {
  return new Date().toISOString()
}

// ── Execution modes ─────────────────────────────────────────────────────────

async function executeBlocking(
  params: SendMessageParams,
  executor: NevaAgentExecutor,
  store: TaskStore,
): Promise<Task> {
  const taskId = params.metadata?.taskId || crypto.randomUUID()
  const task: Task = {
    id: taskId,
    contextId: params.metadata?.contextId,
    status: { state: 'pending', timestamp: nowISO() },
    artifacts: [],
    history: [params.message],
  }
  store.set(task)

  const bus = new ExecutionEventBus()

  // Run executor in background
  executor.execute(params, bus).catch((err) => {
    bus.publish({ type: 'status', state: 'failed', message: { role: 'agent', parts: [{ type: 'text', text: String(err) }] } })
    bus.finish()
  })

  // Consume all events until done
  for await (const event of bus.events()) {
    if (event.type === 'status') {
      task.status = { state: event.state, message: event.message, timestamp: nowISO() }
      if (event.message) task.history!.push(event.message)
    } else if (event.type === 'artifact') {
      task.artifacts!.push(event.artifact)
    }
  }

  // Ensure terminal state
  if (task.status.state === 'working' || task.status.state === 'pending') {
    task.status = { state: 'completed', timestamp: nowISO() }
  }

  store.set(task)
  return task
}

async function* streamExecution(
  params: SendMessageParams,
  executor: NevaAgentExecutor,
  store: TaskStore,
  requestId: string | number,
): AsyncGenerator<JsonRpcResponse> {
  const taskId = params.metadata?.taskId || crypto.randomUUID()
  const task: Task = {
    id: taskId,
    contextId: params.metadata?.contextId,
    status: { state: 'pending', timestamp: nowISO() },
    artifacts: [],
    history: [params.message],
  }
  store.set(task)

  const bus = new ExecutionEventBus()

  executor.execute(params, bus).catch((err) => {
    bus.publish({ type: 'status', state: 'failed', message: { role: 'agent', parts: [{ type: 'text', text: String(err) }] } })
    bus.finish()
  })

  for await (const event of bus.events()) {
    if (event.type === 'status') {
      task.status = { state: event.state, message: event.message, timestamp: nowISO() }
      if (event.message) task.history!.push(event.message)
      store.set(task)
      yield { jsonrpc: '2.0', id: requestId, result: { task } }
    } else if (event.type === 'artifact') {
      task.artifacts!.push(event.artifact)
      store.set(task)
      yield { jsonrpc: '2.0', id: requestId, result: { artifact: event.artifact } }
    }
  }

  if (task.status.state === 'working' || task.status.state === 'pending') {
    task.status = { state: 'completed', timestamp: nowISO() }
    store.set(task)
    yield { jsonrpc: '2.0', id: requestId, result: { task } }
  }
}

// ── Main handler ────────────────────────────────────────────────────────────

export async function handleJsonRpc(
  request: JsonRpcRequest,
  executor: NevaAgentExecutor,
  store: TaskStore,
): Promise<JsonRpcResponse | AsyncGenerator<JsonRpcResponse>> {
  if (!request.method || !request.id) {
    return errorResponse(request.id ?? null, JSONRPC_ERRORS.INVALID_REQUEST, 'Missing method or id')
  }

  switch (request.method) {
    case 'message/send': {
      const params = request.params as unknown as SendMessageParams
      if (!params?.message) {
        return errorResponse(request.id, JSONRPC_ERRORS.INVALID_PARAMS, 'Missing message param')
      }

      if (params.configuration?.blocking !== false) {
        // Default: blocking
        const task = await executeBlocking(params, executor, store)
        return { jsonrpc: '2.0', id: request.id, result: task }
      }

      // Non-blocking: start execution, return pending task
      const taskId = params.metadata?.taskId || crypto.randomUUID()
      const task: Task = {
        id: taskId,
        contextId: params.metadata?.contextId,
        status: { state: 'pending', timestamp: nowISO() },
        history: [params.message],
      }
      store.set(task)

      const bus = new ExecutionEventBus()
      executor.execute(params, bus).then(async () => {
        for await (const event of bus.events()) {
          if (event.type === 'status') {
            task.status = { state: event.state, message: event.message, timestamp: nowISO() }
          } else if (event.type === 'artifact') {
            if (!task.artifacts) task.artifacts = []
            task.artifacts.push(event.artifact)
          }
        }
        if (task.status.state === 'working') {
          task.status = { state: 'completed', timestamp: nowISO() }
        }
        store.set(task)
      }).catch(() => {
        task.status = { state: 'failed', timestamp: nowISO() }
        store.set(task)
      })

      return { jsonrpc: '2.0', id: request.id, result: task }
    }

    case 'message/stream': {
      const params = request.params as unknown as SendMessageParams
      if (!params?.message) {
        return errorResponse(request.id, JSONRPC_ERRORS.INVALID_PARAMS, 'Missing message param')
      }
      return streamExecution(params, executor, store, request.id)
    }

    case 'tasks/get': {
      const { id } = (request.params || {}) as { id?: string }
      if (!id) return errorResponse(request.id, JSONRPC_ERRORS.INVALID_PARAMS, 'Missing task id')
      const task = store.get(id)
      if (!task) return errorResponse(request.id, JSONRPC_ERRORS.TASK_NOT_FOUND, 'Task not found')
      return { jsonrpc: '2.0', id: request.id, result: task }
    }

    case 'tasks/cancel': {
      const { id } = (request.params || {}) as { id?: string }
      if (!id) return errorResponse(request.id, JSONRPC_ERRORS.INVALID_PARAMS, 'Missing task id')
      const task = store.get(id)
      if (!task) return errorResponse(request.id, JSONRPC_ERRORS.TASK_NOT_FOUND, 'Task not found')

      await executor.cancelTask(id)
      task.status = { state: 'canceled', timestamp: nowISO() }
      store.set(task)
      return { jsonrpc: '2.0', id: request.id, result: task }
    }

    default:
      return errorResponse(request.id, JSONRPC_ERRORS.METHOD_NOT_FOUND, `Unknown method: ${request.method}`)
  }
}
