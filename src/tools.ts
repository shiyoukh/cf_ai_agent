/**
 * Tool definitions for the AI chat agent
 * Tools can either require human confirmation or execute automatically
 */
import { tool, type ToolSet } from "ai";
import { z } from "zod/v3";

import { getCurrentAgent } from "agents";
import { scheduleSchema } from "agents/schedule";

/** Minimal surface we rely on from the current agent (no `any`) */
type AgentLike = {
  schedule?: (input: unknown, method: string, description: string) => unknown;
  getSchedules?: () => unknown[] | undefined;
  cancelSchedule?: (taskId: string) => Promise<unknown> | unknown;
};

/**
 * Weather information tool that requires human confirmation
 */
const getWeatherInformation = tool({
  description: "show the weather in a given city to the user",
  inputSchema: z.object({ city: z.string() })
  // Omitting execute makes this tool require human confirmation
});

/**
 * Local time tool that executes automatically
 */
const getLocalTime = tool({
  description: "get the local time for a specified location",
  inputSchema: z.object({ location: z.string() }),
  execute: async ({ location }) => {
    console.log(`Getting local time for ${location}`);
    return "10am";
  }
});

const scheduleTask = tool({
  description: "A tool to schedule a task to be executed at a later time",
  inputSchema: scheduleSchema,
  execute: async ({ when, description }) => {
    const { agent } = getCurrentAgent() as { agent: AgentLike };

    const fail = (msg: string): never => {
      throw new Error(msg);
    };

    if (when.type === "no-schedule") return "Not a valid schedule input";

    const input: unknown =
      when.type === "scheduled"
        ? when.date
        : when.type === "delayed"
          ? when.delayInSeconds
          : when.type === "cron"
            ? when.cron
            : fail("not a valid schedule input");

    try {
      agent?.schedule?.(input, "executeTask", description);
      return `Task scheduled for type "${when.type}" : ${String(input)}`;
    } catch (error) {
      console.error("error scheduling task", error);
      return `Error scheduling task: ${String(error)}`;
    }
  }
});

const getScheduledTasks = tool({
  description: "List all tasks that have been scheduled",
  inputSchema: z.object({}),
  execute: async () => {
    const { agent } = getCurrentAgent() as { agent: AgentLike };
    try {
      const tasks = agent?.getSchedules?.();
      if (!tasks || tasks.length === 0) return "No scheduled tasks found.";
      return tasks;
    } catch (error) {
      console.error("Error listing scheduled tasks", error);
      return `Error listing scheduled tasks: ${String(error)}`;
    }
  }
});

const cancelScheduledTask = tool({
  description: "Cancel a scheduled task using its ID",
  inputSchema: z.object({
    taskId: z.string().describe("The ID of the task to cancel")
  }),
  execute: async ({ taskId }) => {
    const { agent } = getCurrentAgent() as { agent: AgentLike };
    try {
      await agent?.cancelSchedule?.(taskId);
      return `Task ${taskId} has been successfully canceled.`;
    } catch (error) {
      console.error("Error canceling scheduled task", error);
      return `Error canceling task ${taskId}: ${String(error)}`;
    }
  }
});

/** Export all available tools */
export const tools = {
  getWeatherInformation,
  getLocalTime,
  scheduleTask,
  getScheduledTasks,
  cancelScheduledTask
} satisfies ToolSet;

/** Implementations for confirmation-required tools */
export const executions = {
  getWeatherInformation: async ({ city }: { city: string }) => {
    console.log(`Getting weather information for ${city}`);
    return `The weather in ${city} is sunny`;
  }
};
