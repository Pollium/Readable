import { BaseModel, JsonColumn } from '@pollium/readable/database/models';
import { Column, Entity } from 'typeorm';

@Entity()
export default class Note extends BaseModel{
    @Column()
    title!: string;

    @JsonColumn()
    tags!: string[];
}
