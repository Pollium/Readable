import {
    getMetadataArgsStorage,
    Column,
    BaseEntity,
    PrimaryColumn,
    CreateDateColumn,
    UpdateDateColumn
} from 'typeorm';
import { v7 as uuidv7, NIL as NIL_UUID } from 'uuid';

export interface FkOptions{
    onDelete?: 'CASCADE' | 'SET NULL' | 'RESTRICT' | 'NO ACTION';
    nullable?: boolean;
}

export { uuidv7, NIL_UUID };
const hiddenFields = new WeakMap<object, Set<string>>();

export const Hidden = (): PropertyDecorator => {
    return (target, propertyKey) => {
        const ctor = target.constructor;
        let fields = hiddenFields.get(ctor);
        if(!fields){
            fields = new Set();
            hiddenFields.set(ctor, fields);
        }
        fields.add(String(propertyKey));
    };
};

export const getHiddenFields = (ctor: object): Set<string> => {
    const collected = new Set<string>();
    let current: unknown = ctor;
    while(typeof current === 'function' && current !== Function.prototype){
        const own = hiddenFields.get(current);
        if(own){
            for(const field of own){
                collected.add(field);
            }
        }
        current = Object.getPrototypeOf(current);
    }
    return collected;
};

export const Fk = (entity: string, options: FkOptions = {}): PropertyDecorator =>
    (target, propertyKey) => {
        const column = String(propertyKey);
        const relation = column.endsWith('Id') ? column.slice(0, -2) : `_${column}`;
        const nullable = options.nullable === true;

        Column({ type: 'uuid', ...(nullable ? { nullable: true } : {}) })(target, column);

        getMetadataArgsStorage().relations.push({
            target: target.constructor,
            propertyName: relation,
            relationType: 'many-to-one',
            isLazy: false,
            type: entity,
            options: {
                ...(options.onDelete === undefined ? {} : { onDelete: options.onDelete }),
                nullable
            }
        });

        getMetadataArgsStorage().joinColumns.push({
            target: target.constructor,
            propertyName: relation,
            name: column,
            referencedColumnName: 'id'
        });
    };

export abstract class BaseModel extends BaseEntity{
    @PrimaryColumn({ type: 'uuid', default: () => 'uuidv7()' })
    id: string = uuidv7();

    @CreateDateColumn()
    createdAt!: Date;

    @UpdateDateColumn()
    updatedAt!: Date;

    toJSON(): Record<string, unknown>{
        const hidden = getHiddenFields(this.constructor);
        const output: Record<string, unknown> = {};
        for(const [key, value] of Object.entries(this)){
            if(!hidden.has(key)){
                output[key] = value;
            }
        }
        return output;
    }
}
