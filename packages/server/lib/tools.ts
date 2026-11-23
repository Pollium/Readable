import { ClassMetadata } from './metadata';
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

const groupByClass = new WeakMap<object, string>();
const toolsByClass = new ClassMetadata<ToolBinding>();

export const DefineToolGroup = (group: string): ClassDecorator => {
    return (target) => {
        groupByClass.set(target, group);
    };
};

export const getToolGroup = (ctor: object): string | undefined => {
    return groupByClass.get(ctor);
};

export const Tool = <T>(definition: ToolDefinition<T>): MethodDecorator => {
    return (target, handlerName) => {
        toolsByClass.append(target.constructor, {
            tool: String(handlerName),
            handlerName,
            definition: definition as ToolDefinition<unknown>
        });
    };
};

export const getTools = (ctor: object): ToolBinding[] => {
    return toolsByClass.get(ctor);
};
