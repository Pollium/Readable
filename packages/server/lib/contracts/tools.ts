import { ILlmSchema, IValidation } from 'typia';

export enum ToolAccess{
    Read = 'read',
    Write = 'write'
}

export interface ToolContext{
    userId: string,
    teamId: string,
    sessionId: string;
}

export interface ToolDefinition<T>{
    description: string;
    access: ToolAccess;
    parameters: ILlmSchema.IParameters;
    validate: (input: unknown) => IValidation<T>;
    decline?: string;
    unattended?: boolean;
    approval?: boolean;
}

export interface ToolApprovalOptions{
    unattended?: boolean;
    omit?: readonly string[];
}

export interface ToolBinding{
    tool: string;
    handlerName: string | symbol;
    definition: ToolDefinition<unknown>;
}

export type ToolHandler = (context: ToolContext, input: never) => unknown;