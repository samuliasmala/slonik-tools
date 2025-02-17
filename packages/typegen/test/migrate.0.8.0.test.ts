import * as fsSyncer from 'fs-syncer'
import * as typegen from '../src'
import {getHelper} from './helper'

export const {typegenOptions, logger, poolHelper: helper} = getHelper({__filename})

beforeEach(async () => {
  await helper.pool.query(helper.sql`
    create table test_table(
      id int primary key,
      n int
    );
  `)
})

jest.mock('child_process', () => ({
  ...jest.requireActual<any>('child_process'),
  execSync: (command: string) => {
    if (command === 'git diff --exit-code') {
      throw new Error(`[fake git diff output]`)
    } else {
      throw new Error(`Unexpected command was run!`)
    }
  },
}))

test('checks git diff before running', async () => {
  const syncer = fsSyncer.jestFixture({
    targetState: {},
  })

  syncer.sync()

  await expect(
    typegen.generate({
      ...typegenOptions(syncer.baseDir),
      migrate: '<=0.8.0',
      checkClean: ['before-migrate'],
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(
    `"Failure: git status should be clean - stage or commit your changes before re-running.: Error: [fake git diff output]"`,
  )
})

test('migrate old codegen', async () => {
  const syncer = fsSyncer.jestFixture({
    targetState: {
      'db.ts': `
        import {knownTypes} from './generated/db'
        import {setupTypeGen} from '@slonik/typegen'
        import {createPool} from 'slonik'

        export const {sql, poolConfig} = setupTypeGen({
          knownTypes,
          writeTypes: process.env.NODE_ENV !== 'production' && process.cwd() + '/src/generated/db',
        })

        export const slonik = createPool('...', poolConfig)

        export const queryA = sql.Foo\`
          select 1 as a
        \`

        export const queryB = sql\`
          select 1 as b
        \`
      `,
      'mixed-sql-import-first.ts': `
        import {sql, queryB} from './db'

        export default [sql, queryB]
      `,
      'mixed-sql-import-last.ts': `
        import {queryB, sql} from './db'

        export default [sql, queryB]
      `,
      'mixed-sql-import-middle.ts': `
        import {queryB, sql, queryA} from './db'

        export default [queryB, sql, queryA]
      `,
      'solo-sql-import.ts': `
        import {sql} from './db'

        export default [sql]
      `,
      'non-sql-tags-ignored.ts': `
        import * as fs from 'fs' // no named imports
        import 'path' // no import clause

        export const a = fs.readFileSync

        declare const gql: any
        export const b = gql.Foo\`someQuery {someField}\`
      `,
      'non-slonik-typegen-codegen-ignored.ts': `
        /* eslint-disable */
        // tslint:disable
        // this file is generated by a tool; don't change it manually.

        // bit of an edge-case, but just to be sure...
        // this file should _not_ be removed

        export default 123
      `,
      generated: {
        db: {
          'Foo.ts': `
            /* eslint-disable */
            // tslint:disable
            // this file is generated by a tool; don't change it manually.

            export type Foo_AllTypes = [
              {
                /** pg_type.typname: timestamptz */
                d: Date
              }
            ]
            export interface Foo_QueryTypeMap {
              [\`select d from foo where d is not null limit 1\`]: Foo_AllTypes[0]
            }

            export type Foo_UnionType = Foo_QueryTypeMap[keyof Foo_QueryTypeMap]

            export type Foo = {
              [K in keyof Foo_UnionType]: Foo_UnionType[K]
            }
            export const Foo = {} as Foo

            export const Foo_meta_v0 = []
          `,
          '_pg_types.ts': `
            /* eslint-disable */
            // tslint:disable
            // this file is generated by a tool; don't change it manually.

            export const _pg_types = {
              aclitem: 'aclitem',
              any: 'any',
              // ... many skipped
              _xml: '_xml'
            } as const

            export type _pg_types = typeof _pg_types
          `,
          'index.ts': `
            /* eslint-disable */
            // tslint:disable
            // this file is generated by a tool; don't change it manually.
            import {Foo} from './Foo'
            import {_pg_types} from './_pg_types'

            export {Foo}
            export {_pg_types}

            export interface KnownTypes {
              Foo: Foo
              _pg_types: _pg_types
            }

            /** runtime-accessible object with phantom type information of query results. */
            export const knownTypes: KnownTypes = {
              Foo,
              _pg_types,
            }
          `,
        },
      },
    },
  })

  logger.warn.mockReset()

  syncer.sync()

  await typegen.generate({
    ...typegenOptions(syncer.baseDir),
    migrate: '<=0.8.0',
  })

  expect(logger.warn).toHaveBeenCalled()
  expect(logger.warn).toHaveBeenCalledWith(
    expect.stringMatching(/WARNING: "poolConfig" should be removed manually - .*:\d+\d+/),
  )

  expect(syncer.yaml()).toMatchInlineSnapshot(`
    "---
    db.ts: |-
      import {sql} from 'slonik'
      
      import {createPool} from 'slonik'
      
      /* setupTypeGen call removed. There may be remaining references to poolConfig which should be deleted manually */
      
      export const slonik = createPool('...', poolConfig)
      
      export const queryA = sql<queries.A>\`
        select 1 as a
      \`
      
      export const queryB = sql<queries.B>\`
        select 1 as b
      \`
      
      export declare namespace queries {
        // Generated by @slonik/typegen
      
        /** - query: \`select 1 as a\` */
        export interface A {
          /** regtype: \`integer\` */
          a: number | null
        }
      
        /** - query: \`select 1 as b\` */
        export interface B {
          /** regtype: \`integer\` */
          b: number | null
        }
      }
      
    mixed-sql-import-first.ts: |-
      import {sql} from 'slonik'
      import {queryB} from './db'
      
      export default [sql, queryB]
      
    mixed-sql-import-last.ts: |-
      import {sql} from 'slonik'
      import {queryB} from './db'
      
      export default [sql, queryB]
      
    mixed-sql-import-middle.ts: |-
      import {sql} from 'slonik'
      import {queryB, queryA} from './db'
      
      export default [queryB, sql, queryA]
      
    non-slonik-typegen-codegen-ignored.ts: |-
      /* eslint-disable */
      // tslint:disable
      // this file is generated by a tool; don't change it manually.
      
      // bit of an edge-case, but just to be sure...
      // this file should _not_ be removed
      
      export default 123
      
    non-sql-tags-ignored.ts: |-
      import * as fs from 'fs' // no named imports
      import 'path' // no import clause
      
      export const a = fs.readFileSync
      
      declare const gql: any
      export const b = gql.Foo\`someQuery {someField}\`
      
    solo-sql-import.ts: |-
      import {sql} from 'slonik'
      
      export default [sql]
      
    generated: 
      db: "
  `)
})
