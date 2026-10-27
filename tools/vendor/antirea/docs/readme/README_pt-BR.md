# antirea

[English](../../README.md) · [简体中文](README_zh.md) · [繁體中文](README_zh-TW.md) · [日本語](README_ja.md) · [한국어](README_ko.md) · [Türkçe](README_tr.md) · [Русский](README_ru.md) · [Tiếng Việt](README_vi.md) · [ไทย](README_th.md) · [Deutsch](README_de.md) · [Español](README_es.md) · [Français](README_fr.md) · [Українська](README_uk.md) · [Polski](README_pl.md) · **Português (Brasil)** · [العربية](README_ar.md) · [فارسی](README_fa.md) · [Bahasa Indonesia](README_id.md) · [Italiano](README_it.md) · [Ελληνικά](README_el.md) · [മലയാളം](README_ml.md)

**Uma skill que protege seu projeto de ferramentas de engenharia reversa baseadas em IA, como o REA.**

`rea` e ferramentas similares direcionam agentes de IA via MCP para analisar binários, pacotes JS e APKs do projeto. O Antirea coloca diretivas de "parar" exatamente onde os agentes leem primeiro.

## Como funciona

O REA ataca em três etapas:

```
1. Usuário → carrega o skill REA no agente
2. Skill REA → instrui o agente a chamar ferramentas MCP (open_binary, analyze_javascript_application etc.)
3. Agente → lê e analisa os arquivos/binários do projeto
```

O Antirea intervém na etapa 2. Um agente compatível lê os arquivos de instruções do projeto antes de tomar qualquer ação. O Antirea escreve diretivas de bloqueio do REA nesses arquivos.

```
1. Usuário → carrega o skill REA no agente
2. Skill REA → diz ao agente "chame open_binary"
3. Agente → lê AGENTS.md primeiro → vê a diretiva "REA PROIBIDO" → PARA
```

## Camadas de defesa

| Camada | Ferramenta | Função |
|--------|-----------|--------|
| **L1** Barreira de instruções do agente | `AGENTS.md`, `CLAUDE.md`, `.cursor/rules` | Agente compatível recusa chamar ferramentas REA |
| **L1** Negação legível por máquina | `.re-deny` | Sinal legível por máquina para ferramentas compatíveis com REA |
| **L2** Shim de terminal | `node_modules/.bin/rea` | Intercepta `npx rea-agents` e `rea` CLI, exit 1 |
| **L3** Ofuscação JS | `javascript-obfuscator` | Todos os identificadores viram `a`, `b`, `c`... — saída do REA sem sentido |
| **L3** Remoção de source map | `strip-sourcemaps.js` | Arquivos `.map` não chegam à distribuição |
| **L3** Hash de canais IPC | `antirea-ipc-hash.js` | Nomes de canais Electron viram hashes como `ch_a3f9b2` |
| **L3** Criptografia ASAR | electron-builder fuses | `analyze_javascript_application` não consegue ler o ASAR |
| **L3** Remoção de símbolos de depuração | strip / CMake flags | `binary_overview` / `analyze_function` só vê `sub_XXXX` |
| **L3** Remoção do Rust .dep-v0 | `antirea-strip-rust.sh` | `inspect_rust_binary` não vê a árvore de dependências |
| **L3** Go strip + trimpath | `-ldflags="-s -w" -trimpath` | `inspect_go_binary` não retorna informações de módulos |
| **L3** Android R8 + ProGuard | `proguard-antirea.pro` | JADX só vê `class a { void a(b c) }` |
| **L3** Ofuscação .NET | ConfuserEx | Metadados CIL embaralhados, strings criptografadas |

## Ordem de execução

```
npm install   →  postinstall: shims instalados em node_modules/.bin
npm run build →  prebuild: embed-barrier.js roda, barreira embutida no artefato
               →  build: build normal continua
```

## Instalação

### 1. AGENTS.md / CLAUDE.md

Copie o conteúdo de `templates/agents-inject.md` para o **início** do seu arquivo de instruções de agente existente. Se não houver nenhum, copie-o diretamente como `AGENTS.md`.

### 2. .re-deny

Copie `templates/re-deny` para o diretório raiz do projeto como `.re-deny`.

### 3. package.json (projetos JavaScript)

Adicione ao `package.json`:

```json
{
  "rea": {
    "deny": true,
    "reason": "Analysis not authorized by project owner.",
    "contact": ""
  },
  "dependencies": {
    "rea-agents": "file:scripts/rea-agents-shim"
  }
}
```

### 4. Honeypot (opcional)

**JavaScript:** Copie `templates/honeypot-js.js` para seu projeto com o nome correspondente ao campo `"main"` no `package.json` (ex.: `app.js`, `bundle.js`).

**Native:** Compile `templates/honeypot-native.c` e coloque com o mesmo nome do binário que o REA abriria:

```bash
# Linux
cc -shared -fPIC -o libcore.so templates/honeypot-native.c

# macOS
cc -dynamiclib -o libcore.dylib templates/honeypot-native.c
```

## Limites importantes

| Cenário | O Antirea consegue parar? |
|---------|--------------------------|
| Agente com skill REA carregado (Claude Code, Cursor, Codex) | **Sim** — barreira AGENTS.md |
| `npx rea-agents` executado no diretório do projeto | **Sim** — shim node_modules/.bin |
| Bundle/binary distribuído analisado | **Parcialmente** — agentes compatíveis param via embed-barrier.js |
| `rea` executado fora do projeto por caminho absoluto | **Não** |
| Agente que ignora arquivos de instruções | **Não** |
| Ofuscação de binários / proteção real | **Fora do escopo** |

## Requisitos

- **Node.js** 18 ou superior
- **npm** 8 ou superior
- As ferramentas de hardening (javascript-obfuscator, ProGuard, ConfuserEx etc.) são instaladas separadamente por projeto — o antirea não as instala por você

## Aviso legal

**O Antirea é fornecido no estado em que se encontra, sem garantias de qualquer tipo.**

- O Antirea não garante que a engenharia reversa do seu projeto seja impossível. Ele aumenta significativamente o custo e a complexidade da análise assistida por IA, mas um analista experiente com acesso físico ao seu binário e tempo ilimitado ainda pode realizá-la.
- Os autores do antirea não aceitam responsabilidade por danos, perdas ou consequências legais decorrentes do uso ou mau uso desta ferramenta.
- É sua responsabilidade verificar que as proteções do antirea foram aplicadas corretamente antes da distribuição.
- O Antirea não constitui aconselhamento jurídico. Se precisar de proteção legal para sua propriedade intelectual, consulte um advogado qualificado.

**Ao usar o antirea, você aceita total responsabilidade pelo resultado.**

## Contribuições

Encontrou uma brecha na proteção? Abra uma issue ou pull request.

## Licença

MIT