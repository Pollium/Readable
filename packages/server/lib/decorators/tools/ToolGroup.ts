import ClassMetadata from '../../utils/ClassMetadata';
import { ToolBinding, ToolDefinition } from '../../contracts/tools';

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
