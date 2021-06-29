import * as fsSyncer from 'fs-syncer'
import * as typegen from '../src'
import {getHelper} from './helper'
import './register-mock-serializer'

export const {typegenOptions, logger, poolHelper: helper} = getHelper({__filename})

beforeEach(async () => {
  jest.resetAllMocks()

  await helper.pool.query(helper.sql`
    create table test_table(
      id int primary key,
      n int
    );
  `)
})

test(`multi statements don't get types`, async () => {
  const syncer = fsSyncer.jestFixture({
    targetState: {
      'index.ts': `
        import {sql} from 'slonik'

        export default sql\`
          insert into test_table(id, n) values (1, 2);
          insert into test_table(id, n) values (3, 4);
        \`
      `,
      'test.sql': `
        drop table test_table;
        -- make sure multi statements in .sql files are handled properly
        select now();
      `,
    },
  })

  syncer.sync()

  await typegen.generate(typegenOptions(syncer.baseDir))

  expect(logger.error).not.toHaveBeenCalled()

  await expect(helper.pool.one(helper.sql`select count(*) from test_table`)).resolves.toEqual({count: 0})

  expect(syncer.yaml()).toMatchInlineSnapshot(`
    "---
    index.ts: |-
      import {sql} from 'slonik'
      
      export default sql\`
        insert into test_table(id, n) values (1, 2);
        insert into test_table(id, n) values (3, 4);
      \`
      
    test.sql: |-
      drop table test_table;
      -- make sure multi statements in .sql files are handled properly
      select now();
      "
  `)
})

test('variable table name', async () => {
  const syncer = fsSyncer.jestFixture({
    targetState: {
      'index.ts': `
        import {sql} from 'slonik'

        const tableName = 'test_table'

        export default sql\`select * from ${'${sql.identifier([tableName])}'}\`
      `,
    },
  })

  syncer.sync()

  await typegen.generate(typegenOptions(syncer.baseDir))

  expect(logger.error).not.toHaveBeenCalled()
  expect(logger.debug).toHaveBeenCalledWith(
    expect.stringMatching(/Query `select \* from \$1` in file .*index.ts is not typeable/),
  )

  expect(syncer.yaml()).toMatchInlineSnapshot(`
    "---
    index.ts: |-
      import {sql} from 'slonik'
      
      const tableName = 'test_table'
      
      export default sql\`select * from \${sql.identifier([tableName])}\`
      "
  `)
})

test('duplicate columns', async () => {
  const syncer = fsSyncer.jestFixture({
    targetState: {
      'index.ts': `
        import {sql} from 'slonik'

        export default sql\`select 1 as a, 'two' as a\`
      `,
    },
  })

  syncer.sync()

  await typegen.generate(typegenOptions(syncer.baseDir))

  expect(syncer.yaml()).toMatchInlineSnapshot(`
    "---
    index.ts: |-
      import {sql} from 'slonik'
      
      export default sql<queries.A_a>\`select 1 as a, 'two' as a\`
      
      export declare namespace queries {
        // Generated by @slonik/typegen
      
        /** - query: \`select 1 as a, 'two' as a\` */
        export interface A_a {
          /**
           * Warning: 2 columns detected for field a!
           *
           * regtype: \`integer\`
           *
           * regtype: \`text\`
           */
          a: (number | null) | (string | null)
        }
      }
      "
  `)
})

test('void queries', async () => {
  const syncer = fsSyncer.jestFixture({
    targetState: {
      'index.ts': `
        import {sql} from 'slonik'

        export default [
          sql\`update test_table set n = 0\`,
          sql\`insert into test_table values (0, 0)\`,
          sql\`create table x (y int)\`,
        ]
      `,
    },
  })

  syncer.sync()

  await typegen.generate(typegenOptions(syncer.baseDir))

  expect(syncer.yaml()).toMatchInlineSnapshot(`
    "---
    index.ts: |-
      import {sql} from 'slonik'
      
      export default [
        sql<queries._void>\`update test_table set n = 0\`,
        sql<queries._void>\`insert into test_table values (0, 0)\`,
        sql<queries._void>\`create table x (y int)\`,
      ]
      
      export declare namespace queries {
        // Generated by @slonik/typegen
      
        /**
         * queries:
         * - \`update test_table set n = 0\`
         * - \`insert into test_table values (0, 0)\`
         * - \`create table x (y int)\`
         */
        export type _void = void
      }
      "
  `)
})

test('simple', async () => {
  const syncer = fsSyncer.jestFixture({
    targetState: {
      'index.ts': `
        import {sql} from 'slonik'

        export default sql\`
          select 1 as a, 'two' as b
        \`
      `,
    },
  })

  syncer.sync()

  await typegen.generate(typegenOptions(syncer.baseDir))

  expect(logger.warn).not.toHaveBeenCalled()
  expect(logger.error).not.toHaveBeenCalled()

  expect(syncer.yaml()).toMatchInlineSnapshot(`
    "---
    index.ts: |-
      import {sql} from 'slonik'
      
      export default sql<queries.A_b>\`
        select 1 as a, 'two' as b
      \`
      
      export declare namespace queries {
        // Generated by @slonik/typegen
      
        /** - query: \`select 1 as a, 'two' as b\` */
        export interface A_b {
          /** regtype: \`integer\` */
          a: number | null
      
          /** regtype: \`text\` */
          b: string | null
        }
      }
      "
  `)
})

test('queries with comments are modified', async () => {
  const syncer = fsSyncer.jestFixture({
    targetState: {
      'index.ts': `
        import {sql} from 'slonik'

        export default sql\`
          select
            1 as a, -- comment
            -- comment
            2 as b,
            '--' as c, -- comment
            id
          from
            -- comment
            test_table -- comment
        \`
      `,
    },
  })

  syncer.sync()

  await typegen.generate(typegenOptions(syncer.baseDir))

  expect(logger.warn).toHaveBeenCalled()
  expect(logger.warn).toMatchInlineSnapshot(`
    - - >-
        [cwd]/packages/typegen/test/fixtures/limitations.test.ts/queries-with-comments-are-modified/index.ts:3
        Describing query failed: AssertionError [ERR_ASSERTION]: Error running psql
        query.

        Query: "select 1 as a, -- comment 2 as b, '--' as c, -- comment id from
        test_table -- comment \\\\gdesc"

        Result: "psql:<stdin>:1: ERROR:  syntax error at end of input\\nLINE 1:
        select 1 as a, \\n                       ^"

        Error: Empty output received. Try moving comments to dedicated lines.

  `)
})

test('queries with complex CTEs and comments fail with helpful warning', async () => {
  const syncer = fsSyncer.jestFixture({
    targetState: {
      'index.ts': `
        import {sql} from 'slonik'

        export default sql\`
          with abc as (
            select table_name -- comment
            from information_schema.tables
          ),
          def as (
            select table_schema
            from information_schema.tables, abc
          )
          select * from def
        \`
      `,
    },
  })

  syncer.sync()

  await typegen.generate(typegenOptions(syncer.baseDir))

  expect(logger.warn).toHaveBeenCalled()
  expect(logger.warn).toMatchInlineSnapshot(`
    - - >-
        [cwd]/packages/typegen/test/fixtures/limitations.test.ts/queries-with-complex-ctes-and-comments-fail-with-helpful-warning/index.ts:3
        Describing query failed: AssertionError [ERR_ASSERTION]: Error running psql
        query.

        Query: "with abc as ( select table_name -- comment from
        information_schema.tables ), def as ( select table_schema from
        information_schema.tables, abc ) select * from def \\\\gdesc"

        Result: "psql:<stdin>:1: ERROR:  syntax error at end of input\\nLINE 1: with
        abc as ( select table_name \\n                                        ^"

        Error: Empty output received. Try moving comments to dedicated lines.

  `)
})

test('create function gets an anoymous tag', async () => {
  const syncer = fsSyncer.jestFixture({
    targetState: {
      'index.ts': `
        import {sql} from 'slonik'

        export default sql\`create function foo() returns int as 'select 123' language sql\`
      `,
    },
  })

  syncer.sync()

  await typegen.generate(typegenOptions(syncer.baseDir))

  expect(syncer.yaml()).toMatchInlineSnapshot(`
    "---
    index.ts: |-
      import {sql} from 'slonik'
      
      export default sql<queries.Anonymous06b007>\`create function foo() returns int as 'select 123' language sql\`
      
      export declare namespace queries {
        // Generated by @slonik/typegen
      
        /** - query: \`create function foo() returns int as 'select 123' language sql\` */
        export interface Anonymous06b007 {}
      }
      "
  `)
})
