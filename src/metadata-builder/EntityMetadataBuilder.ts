import {MetadataStorage} from "./MetadataStorage";
import {PropertyMetadata} from "./metadata/PropertyMetadata";
import {TableMetadata} from "./metadata/TableMetadata";
import {EntityMetadata} from "./metadata/EntityMetadata";
import {NamingStrategy} from "../naming-strategy/NamingStrategy";
import {ColumnMetadata} from "./metadata/ColumnMetadata";
import {ColumnOptions} from "./options/ColumnOptions";
import {RelationTypes} from "./types/RelationTypes";
import {ForeignKeyMetadata} from "./metadata/ForeignKeyMetadata";

/**
 * Aggregates all metadata: table, column, relation into one collection grouped by tables for a given set of classes.
 */
export class EntityMetadataBuilder {

    // -------------------------------------------------------------------------
    // Constructor
    // -------------------------------------------------------------------------

    constructor(private metadataStorage: MetadataStorage,
                private namingStrategy: NamingStrategy) {
    }

    // -------------------------------------------------------------------------
    // Public Methods
    // -------------------------------------------------------------------------

    /**
     * Builds a complete metadata aggregations for the given entity classes.
     */
    build(entityClasses: Function[]): EntityMetadata[] {

        // filter the metadata only we need - those which are bind to the given table classes
        const tableMetadatas = this.metadataStorage.findTableMetadatasForClasses(entityClasses);
        const abstractTableMetadatas = this.metadataStorage.findAbstractTableMetadatasForClasses(entityClasses);
        const columnMetadatas = this.metadataStorage.findFieldMetadatasForClasses(entityClasses);
        const relationMetadatas = this.metadataStorage.findRelationMetadatasForClasses(entityClasses);
        const indexMetadatas = this.metadataStorage.findIndexMetadatasForClasses(entityClasses);
        const compoundIndexMetadatas = this.metadataStorage.findCompoundIndexMetadatasForClasses(entityClasses);

        const entityMetadatas = tableMetadatas.map(tableMetadata => {

            const constructorChecker = (opm: PropertyMetadata) => opm.target === tableMetadata.target;
            const constructorChecker2 = (opm: { target: Function }) => opm.target === tableMetadata.target;

            let entityColumns = columnMetadatas.filter(constructorChecker);
            let entityRelations = relationMetadatas.filter(constructorChecker);
            let entityCompoundIndices = compoundIndexMetadatas.filter(constructorChecker2);
            let entityIndices = indexMetadatas.filter(constructorChecker);

            // merge all columns in the abstract table extendings of this table
            abstractTableMetadatas.forEach(abstractMetadata => {
                if (!this.isTableMetadataExtendsAbstractMetadata(tableMetadata, abstractMetadata)) return;
                const constructorChecker = (opm: PropertyMetadata) => opm.target === abstractMetadata.target;
                const constructorChecker2 = (opm: { target: Function }) => opm.target === abstractMetadata.target;

                const abstractColumns = columnMetadatas.filter(constructorChecker);
                const abstractRelations = entityRelations.filter(constructorChecker);
                const abstractCompoundIndices = entityCompoundIndices.filter(constructorChecker2);
                const abstractIndices = indexMetadatas.filter(constructorChecker);

                const inheritedFields = this.filterObjectPropertyMetadatasIfNotExist(abstractColumns, entityColumns);
                const inheritedRelations = this.filterObjectPropertyMetadatasIfNotExist(abstractRelations, entityRelations);
                const inheritedIndices = this.filterObjectPropertyMetadatasIfNotExist(abstractIndices, entityIndices);

                entityCompoundIndices = entityCompoundIndices.concat(abstractCompoundIndices);
                entityColumns = entityColumns.concat(inheritedFields);
                entityRelations = entityRelations.concat(inheritedRelations);
                entityIndices = entityIndices.concat(inheritedIndices);
            });

            // generate columns for relations
           /* const relationColumns = entityRelations
                .filter(relation => relation.isOwning && (relation.relationType === RelationTypes.ONE_TO_ONE || relation.relationType ===RelationTypes.MANY_TO_ONE))
                .filter(relation => !entityColumns.find(column => column.name === relation.name))
                .map(relation => {
                    const options: ColumnOptions = {
                        type: "int", // todo: setup proper inverse side type later
                        oldColumnName: relation.oldColumnName,
                        isNullable: relation.isNullable
                    };
                    return new ColumnMetadata(tableMetadata.target, relation.name, false, false, false, options);
                });

            const allColumns = entityColumns.concat(relationColumns);*/

            const entityMetadata = new EntityMetadata(tableMetadata, entityColumns, entityRelations, entityIndices, entityCompoundIndices, []);

            // set naming strategies
            tableMetadata.namingStrategy = this.namingStrategy;
            entityColumns.forEach(column => column.namingStrategy = this.namingStrategy);
            entityRelations.forEach(relation => relation.namingStrategy = this.namingStrategy);

            return entityMetadata;
        });

        // generate columns and foreign keys for tables with relations
        entityMetadatas.forEach(metadata => {
            const foreignKeyRelations = metadata.ownerOneToOneRelations.concat(metadata.manyToOneRelations);
            foreignKeyRelations.map(relation => {
                const inverseSideMetadata = entityMetadatas.find(metadata => metadata.target === relation.type);

                // find relational columns and if it does not exist - add it
                let relationalColumn = metadata.columns.find(column => column.name === relation.name);
                if (!relationalColumn) {
                    const options: ColumnOptions = {
                        type: inverseSideMetadata.primaryColumn.type,
                        oldColumnName: relation.oldColumnName,
                        isNullable: relation.isNullable
                    };
                    relationalColumn = new ColumnMetadata(metadata.target, relation.name, false, false, false, options);
                    metadata.columns.push(relationalColumn);
                }

                // create and add foreign key
                const foreignKey = new ForeignKeyMetadata(metadata.table, [relationalColumn], inverseSideMetadata.table, [inverseSideMetadata.primaryColumn]);
                metadata.foreignKeys.push(foreignKey);
            });
        });

        // generate junction tables with its columns and foreign keys
        const junctionEntityMetadatas: EntityMetadata[] = [];
        entityMetadatas.forEach(metadata => {
            metadata.ownerManyToManyRelations.map(relation => {
                const inverseSideMetadata = entityMetadatas.find(metadata => metadata.target === relation.type);
                const tableName = metadata.table.name + "_" + relation.name + "_" +
                    inverseSideMetadata.table.name + "_" + inverseSideMetadata.primaryColumn.name;

                const tableMetadata = new TableMetadata(null, tableName, false);
                const column1options: ColumnOptions = {
                    length: metadata.primaryColumn.length,
                    type: metadata.primaryColumn.type,
                    name: metadata.table.name + "_" + relation.name
                };
                const column2options: ColumnOptions = {
                    length: inverseSideMetadata.primaryColumn.length,
                    type: inverseSideMetadata.primaryColumn.type,
                    name: inverseSideMetadata.table.name + "_" + inverseSideMetadata.primaryColumn.name
                };
                const columns = [
                    new ColumnMetadata(null, null, false, false, false, column1options),
                    new ColumnMetadata(null, null, false, false, false, column2options)
                ];
                const foreignKeys = [
                    new ForeignKeyMetadata(tableMetadata, [columns[0]], metadata.table, [metadata.primaryColumn]),
                    new ForeignKeyMetadata(tableMetadata, [columns[1]], inverseSideMetadata.table, [inverseSideMetadata.primaryColumn]),
                ];
                junctionEntityMetadatas.push(new EntityMetadata(tableMetadata, columns, [], [], [], foreignKeys));
            });
        });

        const allEntityMetadatas = entityMetadatas.concat(junctionEntityMetadatas);

        // set inverse side (related) entity metadatas for all relation metadatas
        allEntityMetadatas.forEach(entityMetadata => {
            entityMetadata.relations.forEach(relation => {
                relation.relatedEntityMetadata = allEntityMetadatas.find(m => m.target === relation.type);
            })
        });

        return allEntityMetadatas;
    }

    // -------------------------------------------------------------------------
    // Private Methods
    // -------------------------------------------------------------------------

    private isTableMetadataExtendsAbstractMetadata(tableMetadata: TableMetadata, abstractMetadata: TableMetadata): boolean {
        return tableMetadata.target.prototype instanceof abstractMetadata.target;
    }

    private filterObjectPropertyMetadatasIfNotExist<T extends PropertyMetadata>(newMetadatas: T[], existsMetadatas: T[]): T[] {
        return newMetadatas.filter(fieldFromMapped => {
            return existsMetadatas.reduce((found, fieldFromDocument) => {
                    return fieldFromDocument.propertyName === fieldFromMapped.propertyName ? fieldFromDocument : found;
                }, null) === null;
        });
    }

}