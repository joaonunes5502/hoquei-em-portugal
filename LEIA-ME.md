# Hóquei em Português — como pôr tudo a funcionar

O projeto tem quatro peças:

| Peça | Ficheiros | O que faz |
|---|---|---|
| **Base de dados** | `supabase/schema.sql` | Guarda jogos, classificações, plantéis, notícias, etc. (Supabase) |
| **Robô** | `scraper/scrape.py` + `.github/workflows/scrape.yml` | Vai ao hp.fpp.pt e atualiza a base de dados sozinho (GitHub Actions) |
| **Site** | `index.html`, `app.js`, `estilo.css` | O site público |
| **Backoffice** | `admin.html`, `admin.js` | Onde escreves notícias e editas tudo |

`config.js` liga o site e o backoffice ao Supabase. `demo.js` só serve para o modo demonstração.

> **Antes de começar:** abre o `index.html` e o `admin.html` no browser (duplo clique). Funcionam em **modo demonstração** (faixa amarela), para veres tudo antes de configurar.

---

## Passo 1 — Criar a base de dados (Supabase) · 5 min

Já tens um projeto no Supabase, por isso podes usar esse.

1. Entra em [supabase.com](https://supabase.com) e abre o teu projeto.
2. No menu da esquerda, abre **SQL Editor** e carrega em **New query**.
3. Abre o ficheiro `supabase/schema.sql`, copia **tudo**, cola e carrega em **Run**. Deve aparecer *Success*.
4. Numa query nova, troca o email pelo teu e corre:
   ```sql
   insert into admins (email) values ('o-teu-email@gmail.com');
   ```
5. Abre **Authentication → Users → Add user → Create new user**. Põe esse mesmo email e uma palavra-passe, e marca *Auto Confirm User*. É com estes dados que entras no backoffice.
6. Em **Authentication → Sign In / Providers → Email**, desliga **Allow new users to sign up**. Assim ninguém cria contas. Mesmo que alguém criasse, não tinha permissões, porque não está na tabela `admins`.
7. Guarda estes três valores:
   - **Project URL**: carrega no botão verde **Connect** no topo do Supabase, ou abre **Settings → Data API**. Tem a forma `https://xxxxxxxx.supabase.co`.
   - **Publishable key** (`sb_publishable_…`), em **Settings → API Keys**: vai para o `config.js`.
   - **Secret key** (`sb_secret_…`), na mesma página (carrega no olho para a veres): ⚠️ **nunca vai para o site**, só para os segredos do GitHub.

   As chaves antigas `anon` e `service_role` (em *View legacy API keys*) também funcionam, mas o Supabase vai desligá-las em 2027.

## Passo 2 — Ligar o site ao Supabase · 1 min

Abre o `config.js` e preenche:

```js
SUPABASE_URL: "https://abcd.supabase.co",
SUPABASE_ANON_KEY: "sb_publishable_…",
GITHUB_REPO: "o-teu-utilizador/hoquei-em-portugal",
```

A chave *anon* pode estar no site sem problema, porque as permissões da base de dados só deixam o público **ler**.

## Passo 3 — Pôr os ficheiros no GitHub · 5 min

Usa o teu repositório `hoquei-em-portugal`.

1. No GitHub, abre o repositório e vai a **Add file → Upload files**.
2. Arrasta **todo o conteúdo** desta pasta, incluindo as pastas `scraper`, `supabase` e `.github`. Os ficheiros novos substituem o `index.html`, o `admin.html` e o `scrape.yml` antigos.
   - A pasta `.github` começa por um ponto e pode estar escondida. No Mac, carrega em `Cmd + Shift + .` no Finder para a ver.
   - Se o upload não aceitar pastas escondidas: no GitHub, carrega em **Add file → Create new file**, escreve o nome `.github/workflows/scrape.yml` e cola o conteúdo do ficheiro.
3. Carrega em **Commit changes**.

**Público ou privado?** Num repositório **público**, o GitHub Actions é grátis e ilimitado. Num **privado**, tens cerca de 2000 minutos grátis por mês. Nesse caso, abre o `scrape.yml` e troca `*/10` por `*/30`. Tornar o repositório público não tem perigo, porque a chave secreta fica nos segredos e não no código.

## Passo 4 — Segredos do robô · 2 min

Este passo resolve o erro que tiveste da outra vez.

1. No repositório, abre **Settings → Secrets and variables → Actions → New repository secret**.
2. Cria dois segredos:
   - `SUPABASE_URL`, com o Project URL;
   - `SUPABASE_SERVICE_KEY`, com a chave **Secret key** (`sb_secret_…`).

## Passo 5 — Primeira execução do robô · 5 a 15 min

1. Abre o separador **Actions** do repositório. Se aparecer um aviso, carrega em *I understand… enable them*.
2. À esquerda, escolhe **Atualizar dados do hp.fpp.pt** e carrega em **Run workflow**. Deixa o modo `completo` e confirma em **Run workflow**.
3. Espera que fique verde ✅. A primeira execução é a mais lenta, porque descobre as competições e lê os plantéis de todas as equipas. Se ficar vermelho ❌, abre a execução e lê a mensagem: costuma ser um segredo mal copiado.

A partir daqui o robô corre **sozinho**:
- **das 14h às 24h:** de 10 em 10 minutos (resultados, classificações, marcadores, jogos do dia com timeline e números);
- **no resto do dia:** de hora a hora;
- **às 5h:** uma vez por dia, faz a passagem completa (competições novas e plantéis).

> O GitHub desliga as execuções automáticas se o repositório estiver **60 dias sem alterações**. Se isso acontecer, recebes um email e voltas a ligar no separador Actions.

## Passo 6 — Publicar o site (Netlify) · 5 min

Já usas o Netlify, por isso:

1. No [Netlify](https://app.netlify.com), carrega em **Add new site → Import an existing project → GitHub** e escolhe `hoquei-em-portugal`.
2. Deixa *Build command* vazio e *Publish directory* como `/` (ou vazio). Carrega em **Deploy**.
3. O site fica em `https://algumacoisa.netlify.app`, e o backoffice em `…/admin.html`.
4. Opcional: em *Domain settings* podes mudar o nome ou ligar um domínio teu.

Cada vez que mudares um ficheiro no GitHub, o Netlify atualiza o site sozinho.

## Passo 7 — Configurar no backoffice · 10 min

Entra em `…/admin.html` com o email e a palavra-passe do passo 1.

1. **Competições:**
   - escolhe a **principal**, a que aparece na página inicial (normalmente o Campeonato Placard);
   - desliga as que não queres no site;
   - dá-lhes nomes curtos, por exemplo "Campeonato Placard" em vez de "Campeonato Placard HP - Fase Regular".
2. **Clubes:** muda o "nome a mostrar" quando o automático não fica bem (por exemplo "SCT" → "SC Tomar") e escolhe a cor de cada clube.
3. **Jogos e TV:** põe o canal dos jogos transmitidos na televisão.
4. **Textos do site:** escreve o texto da página "Sobre nós".
5. **Notícias:** escreve a primeira 🎉

---

## O que vem do hp.fpp.pt e o que fazes à mão

| Automático (robô) | No backoffice |
|---|---|
| Competições, calendário, resultados | Notícias (com imagens) |
| Classificações e forma | Equipa da jornada |
| Marcadores | Mercado (transferências) |
| Plantéis com foto e golos | Canal de TV, destaques e notas dos jogos |
| Números das camisolas e técnicos (das fichas de jogo) | Nome curto, cor, cidade, pavilhão e descrição dos clubes |
| Timeline (golos, cartões, descontos), faltas, árbitros | Posição, nacionalidade, bio e foto dos jogadores; esconder ou adicionar jogadores |

O robô **nunca apaga** o que escreves no backoffice. As tuas edições ficam em colunas próprias, que ele não toca.

## Problemas comuns

- **No site aparecem "dados de demonstração":** o `config.js` está vazio ou mal preenchido.
- **No backoffice diz "este email não é administrador":** corre o `insert into admins …` do passo 1.4 com o email exato.
- **O robô falha com "Faltam os segredos":** os nomes dos segredos têm de ser exatamente `SUPABASE_URL` e `SUPABASE_SERVICE_KEY`.
- **O robô dá erro numa competição ou num jogo:** o painel do backoffice mostra os erros da última execução. Se o fpp.pt mudar o aspeto das páginas, o `scrape.py` tem de ser ajustado.
- **Testar o robô no computador (opcional):**
  ```
  pip install -r scraper/requirements.txt
  SUPABASE_URL=… SUPABASE_SERVICE_KEY=… python scraper/scrape.py completo
  ```
  Os testes (sem internet) correm com `python scraper/tests/test_parsers.py`.
