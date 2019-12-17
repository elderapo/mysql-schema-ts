import { createConnection, Connection, MysqlError } from 'mysql'
import { parse as urlParse } from 'url'
import { Table } from './typescript'
import { mapColumn } from './column-map'
import { SQL as sql, SQLStatement } from 'sql-template-strings'

function parseEnum(dbEnum: string): string[] {
  return dbEnum.replace(/(^(enum|set)\('|'\)$)/gi, '').split(`','`)
}

function enumNameFromColumn(dataType: string, columnName: string): string {
  return `${dataType}_${columnName}`
}

type EnumRecord = {
  column_name: string
  column_type: string
  data_type: string
}

type TableColumnType = {
  column_name: string
  data_type: string
  is_nullable: string
}

type TableType = {
  table_name: string
}

export type Enums = { [key: string]: string[] }

export function query<T>(conn: Connection, sql: SQLStatement): Promise<T[]> {
  return new Promise((resolve, reject) => {
    conn.query(sql.sql, sql.values, (error: MysqlError | null, results: Array<T>) => {
      if (error) {
        return reject(error)
      }
      return resolve(results)
    })
  })
}

export class MySQL {
  private connection: Connection
  private defaultSchema: string

  constructor(connectionString: string) {
    this.connection = createConnection(connectionString)
    const database = urlParse(connectionString, true).pathname?.substr(1) || 'public'
    this.defaultSchema = database
  }

  public async table(tableName: string): Promise<Table> {
    const enumTypes = await this.enums(tableName)
    const table = await this.getTable(tableName, this.schema())
    return mapColumn(table, enumTypes)
  }

  public async allTables(): Promise<{ name: string; table: Table }[]> {
    const names = await this.tableNames()
    const nameMapping = names.map(async name => ({
      name,
      table: await this.table(name)
    }))

    return Promise.all(nameMapping)
  }

  private async tableNames(): Promise<string[]> {
    const schemaTables = await query<TableType>(
      this.connection,
      sql`SELECT table_name
       FROM information_schema.columns
       WHERE table_schema = ${this.schema()}
       GROUP BY table_name
      `
    )
    return schemaTables.map(schemaItem => schemaItem.table_name)
  }

  public schema(): string {
    return this.defaultSchema
  }

  private async enums(tableName: string): Promise<Enums> {
    const enums: Enums = {}

    const rawEnumRecords = await query<EnumRecord>(
      this.connection,
      sql`SELECT column_name, column_type, data_type 
      FROM information_schema.columns 
      WHERE data_type IN ('enum', 'set')
      AND table_schema = ${this.schema()}
      AND table_name = ${tableName}`
    )

    rawEnumRecords.forEach(enumItem => {
      const enumName = enumNameFromColumn(enumItem.data_type, enumItem.column_name)
      const enumValues = parseEnum(enumItem.column_type)
      enums[enumName] = enumValues
    })

    return enums
  }

  private async getTable(tableName: string, tableSchema: string): Promise<Table> {
    const Table: Table = {}

    const tableColumns = await query<TableColumnType>(
      this.connection,
      sql`SELECT column_name, data_type, is_nullable
       FROM information_schema.columns
       WHERE table_name = ${tableName} 
       AND table_schema = ${tableSchema}`
    )

    tableColumns.forEach(schemaItem => {
      const columnName = schemaItem.column_name
      const dataType = schemaItem.data_type
      const isEnum = /^(enum|set)$/i.test(dataType)
      const nullable = schemaItem.is_nullable === 'YES'

      Table[columnName] = {
        udtName: isEnum ? enumNameFromColumn(dataType, columnName) : dataType,
        nullable
      }
    })

    return Table
  }
}