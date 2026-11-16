"""Teste de ponta a ponta das notificações: um 'telemóvel' falso recebe e decifra a mensagem."""
import sys, os, json, base64, threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from datetime import datetime, timedelta
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives import serialization
import http_ece

b64 = lambda b: base64.urlsafe_b64encode(b).rstrip(b"=").decode()
# chave VAPID do site (como o backoffice a gera: jwk.d)
vk = ec.generate_private_key(ec.SECP256R1())
os.environ["VAPID_PRIVATE_KEY"] = b64(vk.private_numbers().private_value.to_bytes(32, "big"))
import scrape

# "telemóvel": par de chaves do navegador + segredo auth
rk = ec.generate_private_key(ec.SECP256R1())
p256dh = b64(rk.public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint))
auth = os.urandom(16)
recebidas, estado = [], {"codigo": 201}

class H(BaseHTTPRequestHandler):
    def do_POST(self):
        corpo = self.rfile.read(int(self.headers["Content-Length"]))
        txt = http_ece.decrypt(corpo, private_key=rk, auth_secret=auth, version="aes128gcm")
        recebidas.append((self.path, json.loads(txt), self.headers.get("Authorization", "")))
        self.send_response(estado["codigo"]); self.end_headers()
    def log_message(self, *a): pass
srv = HTTPServer(("127.0.0.1", 0), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
url = f"http://127.0.0.1:{srv.server_port}"

agora = datetime.now(scrape.TZ_PT)
k_inicio = agora - timedelta(minutes=5)
k_final = agora - timedelta(minutes=120)
class FakeDB:
    def __init__(s):
        s.enviadas = []; s.apagadas = []
        s.t = {
          "jogos": [
            {"id": 1, "competicao_id": 493, "jornada_nome": "3ª Jornada", "data": k_inicio.date().isoformat(), "hora": k_inicio.strftime("%H:%M"), "casa_id": 1182, "fora_id": 1186, "golos_casa": None, "golos_fora": None},
            {"id": 2, "competicao_id": 498, "jornada_nome": "5ª Jornada", "data": k_final.date().isoformat(), "hora": k_final.strftime("%H:%M"), "casa_id": 1203, "fora_id": 1300, "golos_casa": 5, "golos_fora": 3},
            {"id": 3, "competicao_id": 493, "jornada_nome": "3ª Jornada", "data": k_inicio.date().isoformat(), "hora": k_inicio.strftime("%H:%M"), "casa_id": 1159, "fora_id": 1181, "golos_casa": None, "golos_fora": None}],
          "competicoes": [{"id": 493, "nome": "Campeonato Placard HP - Fase Regular", "nome_curto": "Campeonato Placard", "grupo": "Campeonato Placard", "ativa": True},
                          {"id": 498, "nome": "CN 3ª Divisão Norte A", "nome_curto": None, "grupo": "Campeonato Nacional 3ª Divisão", "ativa": True}],
          "equipas": [{"id": 1182, "nome": "J. Pacense / Des Compagnons", "clube_id": 123, "competicao_id": 493}, {"id": 1186, "nome": "AD Sanjoanense ", "clube_id": 125, "competicao_id": 493},
                      {"id": 1203, "nome": 'J. Pacense "B"', "clube_id": 123, "competicao_id": 498}, {"id": 1300, "nome": "Valença HC", "clube_id": 900, "competicao_id": 498},
                      {"id": 1159, "nome": "Sporting CP", "clube_id": 1329, "competicao_id": 493}, {"id": 1181, "nome": "SL Benfica ", "clube_id": 1333, "competicao_id": 493}],
          "clubes": [{"id": 123, "nome_curto": "Juventude Pacense"}],
          "subscricoes": [{"endpoint": url + "/aparelho1", "p256dh": p256dh, "auth": b64(auth), "equipas": ["123", "123-B"]},
                          {"endpoint": url + "/aparelho-morto", "p256dh": p256dh, "auth": b64(auth), "equipas": ["123"]},
                          {"endpoint": url + "/nao-segue", "p256dh": p256dh, "auth": b64(auth), "equipas": ["999"]}],
          "notificacoes_enviadas": [],
          "notificacoes_manuais": [{"id": "abcd1234-0000", "titulo": "🔔 Teste", "corpo": "Funciona!", "url": "/", "destino": "endpoint", "endpoint": url + "/aparelho1"}]}
    def select(s, table, q):
        if table == "notificacoes_manuais": return [dict(r) for r in s.t[table] if not r.get("enviado_em")]
        return [dict(r) for r in s.t.get(table, [])]
    def upsert(s, table, rows, on_conflict=None):
        if table == "notificacoes_enviadas": s.t[table] += rows
        if table == "notificacoes_manuais":
            for r in rows:
                for x in s.t[table]:
                    if x["id"] == r["id"]: x.update(r)
    def delete(s, table, q): s.apagadas.append(q)

db = FakeDB(); r = scrape.Robo(db); r.hoje = agora.date()
# o "aparelho morto" responde 410 (desinstalado)
class H410(H):
    def do_POST(self):
        if self.path.endswith("morto"):
            self.rfile.read(int(self.headers["Content-Length"])); self.send_response(410); self.end_headers(); return
        super().do_POST()
srv.RequestHandlerClass = H410
r.notificar()
msgs = sorted((p, m["title"], m["body"], m["url"]) for p, m, a in recebidas)
for m in msgs: print(m)
assert ("/aparelho1", "🔔 Teste", "Funciona!", "/") in msgs, "teste manual não chegou"
assert db.t["notificacoes_manuais"][0]["destinatarios"] == 1
assert ("/aparelho1", "🏒 Começou: Juventude Pacense vs AD Sanjoanense", "Campeonato Placard · 3ª Jornada. Vais receber o resultado final quando o jogo terminar.", "/#/jogo/1") in msgs
assert ("/aparelho1", "🏁 Final: Juventude Pacense B 5-3 Valença HC", "CN 3ª Divisão Norte A · 5ª Jornada. Toca para veres a linha de jogo.", "/#/jogo/2") in msgs
assert not any(p == "/nao-segue" for p, *_ in msgs), "enviou a quem não segue"
assert not any("Sporting" in t for _, t, *_ in msgs), "enviou jogo que ninguém segue"
assert any("aparelho-morto" in q for q in db.apagadas), "não apagou o aparelho desinstalado"
print("auth:", recebidas[0][2][:40]); assert all(a.lower().startswith(("vapid ", "webpush ")) and len(a) > 100 for *_, a in recebidas), "falta assinatura VAPID"
assert {(n["jogo_id"], n["tipo"]) for n in db.t["notificacoes_enviadas"]} == {(1, "inicio"), (2, "final"), (3, "inicio")}
# segunda execução: não repete
recebidas.clear(); r.notificar(); assert not recebidas, "repetiu notificações"
print("NOTIFICAÇÕES OK", r.erros)
