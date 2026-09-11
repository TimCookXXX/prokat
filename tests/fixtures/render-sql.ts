// Условие drizzle → настоящий SQL с подставленными значениями.
//
// Нужно там, где важен ОПЕРАТОР, а не только то, что в условии где-то мелькает
// нужная дата. Обход дерева объекта этого не ловит: подмена `gt` на `gte`
// сдвигает границу на сутки, а дата в условии остаётся та же, и тест остаётся
// зелёным, проверяя ровно ничего.
//
// Дешевле живого Postgres и честнее обхода: сравниваем то, что уедет в базу.

import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

const dialect = new PgDialect();

export function renderSql(condition: unknown): string {
  const { sql, params } = dialect.sqlToQuery(condition as SQL);
  // Плейсхолдеры на значения: читать `date > '2026-09-11'` можно, а `date > $2`
  // с отдельным списком параметров — только сверяя их глазами.
  return sql.replace(/\$(\d+)/g, (_, n) => {
    const value = params[Number(n) - 1];
    return typeof value === "string" ? `'${value}'` : String(value);
  });
}
