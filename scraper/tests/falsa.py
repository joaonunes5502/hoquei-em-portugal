"""Base de dados falsa (imita o PostgREST) para os testes."""


class DB:
    def __init__(s): s.t = {}
    def upsert(s, table, rows, on_conflict=None):
        keys = (on_conflict or "id").split(",")
        d = s.t.setdefault(table, {})
        for r in rows:
            k = tuple(r.get(x) for x in keys) if all(x in r for x in keys) else id(r)
            d.setdefault(k, {}).update(r)
    def _f(s, table, q):
        rows = list(s.t.get(table, {}).values())
        for p in q.split("&"):
            if "=" not in p or p.startswith(("select=", "order=", "limit=")):
                continue
            col, cond = p.split("=", 1)
            op, val = cond.split(".", 1)
            if op == "eq": rows = [r for r in rows if str(r.get(col)).lower() == val.lower()]
            if op == "lt": rows = [r for r in rows if r.get(col) is not None and r[col] < int(val)]
            if op == "gt": rows = [r for r in rows if r.get(col) is not None and r[col] > int(val)]
            if op == "in": vs = set(val.strip("()").split(",")); rows = [r for r in rows if str(r.get(col)) in vs]
        return rows
    def select(s, table, q): return [dict(r) for r in s._f(table, q)]
    def delete(s, table, q):
        tirar = {id(r) for r in s._f(table, q)}
        s.t[table] = {k: v for k, v in s.t.get(table, {}).items() if id(v) not in tirar}
        if table == "jogos":  # "on delete cascade"
            vivos = {r["id"] for r in s.t["jogos"].values()}
            s.t["notificacoes_enviadas"] = {k: v for k, v in s.t.get("notificacoes_enviadas", {}).items() if v["jogo_id"] in vivos}
