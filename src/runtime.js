import { Agent } from "./agent.js";
import { createConfiguredModel, loadModelProfiles } from "./models/config.js";
import { createDefaultProviderRegistry } from "./models/providers.js";
import { assertModel } from "./models/model.js";
import { createFilesystemTools } from "./tools/filesystem.js";
import { createCommandTool } from "./tools/command.js";
import { createCodebaseTool } from "./tools/codebase.js";
import { createEditTool } from "./tools/edit.js";
import { createTestTool } from "./tools/test.js";
import { createTaskStateTool } from "./tools/task_state.js";
import { createContextEngine } from "./context/engine.js";
import { createPlanningEngine } from "./planning/engine.js";
import { createAgentMemory } from "./memory/engine.js";
import { createRepositoryIntelligence } from "./repository/engine.js";
import { createToolRegistry } from "./tools/registry.js";

export function createRuntime({
  workspace = process.cwd(),
  model = null,
  modelConfig = {},
  providerRegistry = createDefaultProviderRegistry(),
  modelProfiles = loadModelProfiles(),
  contextConfig = {},
  planningConfig = {},
  memoryConfig = {},
  repositoryConfig = {},
  tokenBudget = {},
  enablePlanning = true,
  enableMemory = true
} = {}) {
  const selectedModel = model || createConfiguredModel({
    ...modelConfig,
    profiles: modelProfiles,
    registry: providerRegistry
  });
  assertModel(selectedModel);

  const filesystem = createFilesystemTools({ workspace });
  const command = createCommandTool({ workspace, timeoutMs: 120_000 });
  const codebase = createCodebaseTool({ workspace, filesystem });
  const edit = createEditTool({ workspace, filesystem });
  const testTool = createTestTool({ workspace, command });
  const taskState = createTaskStateTool({ workspace });
  const contextEngine = createContextEngine({ workspace, filesystem, taskState, ...contextConfig });
  const planningEngine = enablePlanning
    ? createPlanningEngine({ model: selectedModel, contextEngine, taskState, ...planningConfig })
    : null;
  const memory = enableMemory ? createAgentMemory({ workspace, ...memoryConfig }) : null;
  const repositoryIntelligence = createRepositoryIntelligence({ workspace, filesystem, ...repositoryConfig });
  const registry = createToolRegistry({
    ...filesystem,
    run_command: command,
    inspect_codebase: codebase,
    edit_file: edit,
    run_tests: testTool,
    task_state: taskState,
    ...(memory ? { agent_memory: memory } : {}),
    repository_intelligence: repositoryIntelligence
  });
  const tools = registry.toAgentTools();

  const agent = new Agent({
    model: selectedModel,
    tools,
    toolDefinitions: registry.list(),
    contextEngine,
    planningEngine,
    memory,
    repositoryIntelligence,
    tokenBudget
  });

  return {
    agent,
    model: selectedModel,
    modelInfo: selectedModel.describe(),
    providerRegistry,
    registry,
    filesystem,
    edit,
    codebase,
    contextEngine,
    planningEngine,
    memory,
    repositoryIntelligence,
    tokenBudget,
    workspace
  };
}
