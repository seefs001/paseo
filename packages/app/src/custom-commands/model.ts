import { z } from "zod";
import { CLIENT_SLASH_COMMANDS } from "@/client-slash-commands";

const reservedNames = new Set<string>(["share"]);
for (const command of CLIENT_SLASH_COMMANDS) {
  reservedNames.add(command.name.toLowerCase());
  for (const alias of command.aliases) reservedNames.add(alias.toLowerCase());
}

export function normalizeCustomCommandName(name: string): string {
  return name.trim().replace(/^\/+/, "").trim();
}

export type CustomCommandNameError = "nameRequired" | "nameInvalid" | "nameReserved";

export function getCustomCommandNameError(value: string): CustomCommandNameError | null {
  const name = normalizeCustomCommandName(value);
  if (!name) return "nameRequired";
  if (/[\s/"']/.test(name)) return "nameInvalid";
  if (reservedNames.has(name.toLowerCase())) return "nameReserved";
  return null;
}

export const CustomCommandSchema = z.object({
  id: z.string().trim().min(1),
  name: z
    .string()
    .transform(normalizeCustomCommandName)
    .refine((name) => getCustomCommandNameError(name) === null),
  description: z.string().default(""),
  prompt: z.string().refine((prompt) => prompt.trim().length > 0),
  autoSend: z.boolean().default(false),
});

export type CustomCommand = z.infer<typeof CustomCommandSchema>;
export type CustomCommandFieldError = CustomCommandNameError | "nameDuplicate" | "promptRequired";
export type CustomCommandErrors = Partial<Record<"name" | "prompt", CustomCommandFieldError>>;

export function validateCustomCommand(input: {
  command: CustomCommand;
  commands: readonly CustomCommand[];
}): CustomCommandErrors {
  const errors: CustomCommandErrors = {};
  const nameError = getCustomCommandNameError(input.command.name);
  if (nameError) {
    errors.name = nameError;
  } else {
    const name = normalizeCustomCommandName(input.command.name);
    const duplicate = input.commands.some(
      (command) => command.id !== input.command.id && command.name === name,
    );
    if (duplicate) errors.name = "nameDuplicate";
  }
  if (!input.command.prompt.trim()) errors.prompt = "promptRequired";
  return errors;
}

export class CustomCommandValidationError extends Error {
  constructor(readonly fields: CustomCommandErrors) {
    super("Invalid custom command");
    this.name = "CustomCommandValidationError";
  }
}

export function upsertCustomCommand(input: {
  command: CustomCommand;
  commands: readonly CustomCommand[];
}): CustomCommand[] {
  const fields = validateCustomCommand(input);
  if (Object.keys(fields).length > 0) throw new CustomCommandValidationError(fields);
  const command = CustomCommandSchema.parse(input.command);
  const exists = input.commands.some((candidate) => candidate.id === command.id);
  if (!exists) return [...input.commands, command];
  return input.commands.map((candidate) => (candidate.id === command.id ? command : candidate));
}

/** Validate persisted records independently so a damaged entry does not erase other commands. */
export function normalizeCustomCommands(value: unknown): CustomCommand[] {
  if (!Array.isArray(value)) return [];
  const commands: CustomCommand[] = [];
  const ids = new Set<string>();
  const names = new Set<string>();
  for (const entry of value) {
    const parsed = CustomCommandSchema.safeParse(entry);
    if (!parsed.success) continue;
    const command = parsed.data;
    if (ids.has(command.id) || names.has(command.name)) continue;
    ids.add(command.id);
    names.add(command.name);
    commands.push(command);
  }
  return commands;
}
