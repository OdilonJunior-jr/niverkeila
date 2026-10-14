# MADE IN BRASIL · 52 anos

**Convite em produção — GitHub → Vercel → Firebase (quando você quiser configurar)**

Este repositório está **pronto para publicar o site na Vercel sem instalar pacotes e sem rodar build**. A versão não usa PHP nem modo de testes; a arte, os botões clicáveis, a confirmação com acompanhantes, o painel administrativo, as cotas de alimentos e o vídeo original foram preservados.

> **Importante:** é possível publicar o *site visual* agora. Enquanto o Firebase estiver sem configuração, o botão de confirmação avisa que falta conectar os dados e não aceita inscrições; o painel admin ainda não permite login. Isso é intencional para não gravar confirmações falsas. Depois de configurar o Firebase, os registros passam a ser reais.

## ETAPA 1 — Colocar no GitHub (agora)

1. Baixe e **extraia o ZIP**.
2. No [GitHub](https://github.com/new), crie um repositório, por exemplo `convite-made-in-brasil`.
3. Use **Add file → Upload files** para enviar **o conteúdo de dentro da pasta extraída**, incluindo `vercel.json`, `firebase.json`, `public/`, `functions/` e `firestore.rules`. Não envie o ZIP fechado e não crie um nível de pasta adicional.
4. Confirme as alterações (**Commit changes**).

**Estrutura na raiz do repositório:**

```text
convite-made-in-brasil/
├── vercel.json                 ← Vercel já configurada
├── README.md                   ← este manual
├── firebase.json               ← deploy posterior de Functions e Firestore
├── firestore.rules
├── firestore.indexes.json
├── .firebaserc.example
├── .gitignore
├── functions/
│   ├── index.js                ← backend real para ativar depois
│   └── package.json
└── public/                     ← só esta pasta é publicada pela Vercel
    ├── index.html              ← convite
    ├── admin.html              ← painel administrativo
    ├── firebase-config.js      ← dados PÚBLICOS para preencher depois
    ├── js/
    │   ├── firebase-client.js
    │   └── admin.js
    └── assets/
        ├── convite.png
        ├── botao-local.png
        ├── botao-confirmar.png
        └── confirmacao.mp4
```

## ETAPA 2 — Publicar na Vercel (agora)

1. Acesse [vercel.com/new](https://vercel.com/new) e conecte o seu GitHub.
2. Selecione **Import** no repositório criado.
3. Confira:
   - **Root Directory:** `./` (raiz do repositório)
   - **Framework Preset:** `Other`
   - **Build Command:** deixar em branco (nenhum build)
   - **Output Directory:** `public` (já definido em `vercel.json`)
   - **Install Command:** nenhum pacote precisa ser instalado para o site
4. Clique em **Deploy**.
5. A Vercel gera um endereço como `https://seu-projeto.vercel.app`.

**Endereços:**

- Convite: `https://seu-projeto.vercel.app/`
- Painel admin: `https://seu-projeto.vercel.app/admin` (ou `/admin.html`)

**Antes do Firebase**: o convite e a localização funcionam, mas não é possível salvar uma confirmação nem acessar dados do painel. Por isso, não distribua o convite aos convidados até concluir a etapa 3. O link da localização atualmente faz busca por **Capão da Onça, Rufinópolis**; substitua o `urlLocal` no `public/index.html` pelo link exato do Google Maps, se tiver.

## ETAPA 3 — Ligar Firebase mais tarde

A Vercel **continua hospedando o site**. O Firebase fica responsável pelo login, Firestore e funções que controlam as reservas. Você não precisa mudar de hospedagem.

### A. Criar recursos Firebase

1. Entre no [Firebase Console](https://console.firebase.google.com/), abra ou crie um projeto.
2. Ative o **plano Blaze** (necessário para implantar Cloud Functions; pode gerar custos).
3. Em **Firestore Database**, crie o banco `(default)`, de preferência em `southamerica-east1` (São Paulo).
4. Em **Authentication → Sign-in method**, habilite **E-mail/senha** e **Anônimo**.
5. Em **Authentication → Settings → Authorized domains**, adicione o domínio do site na Vercel (ex.: `seu-projeto.vercel.app`; não use `https://` nem `/`). Se adicionar um domínio próprio, autorize-o também.
6. Em **Configurações do projeto → Seus apps**, crie um app **Web** e copie a configuração pública.

### B. Editar a configuração pública e enviar ao GitHub

Edite `public/firebase-config.js` (pelo editor de arquivos do GitHub, por exemplo):

```js
export const firebaseConfig = {
  apiKey: "SUA_API_KEY_PUBLICA",
  authDomain: "SEU_PROJECT_ID.firebaseapp.com",
  projectId: "SEU_PROJECT_ID",
  appId: "SEU_APP_ID",
};
export const functionsRegion = "southamerica-east1";
```

Use os valores exatos exibidos no Firebase Console. A `apiKey` do aplicativo Web é pública, **não** use chave de conta de serviço ou senha administrativa. Ao fazer commit, o GitHub dispara automaticamente um novo deploy na Vercel. Se não tiver certeza, conserve os campos não fornecidos pelo Console só se forem opcionais.

### C. Publicar só o backend e as regras no Firebase

Em um computador com [Node.js 22](https://nodejs.org/) instalado, extraia/clona o repositório e abra o terminal na **raiz**:

```bash
npm install -g firebase-tools
firebase login
cd functions
npm install
cd ..
firebase deploy --project SEU_PROJECT_ID --only functions,firestore
```

Substitua `SEU_PROJECT_ID` pelo ID do projeto Firebase. `firebase.json` já está preparado: **não** rode `firebase init` e **não** publique Firebase Hosting; o site continua na Vercel. As funções têm região `southamerica-east1`, igual à configuração do navegador. Se o Firestore foi criado em outra região, o aplicativo poderá funcionar, mas com latência e custos de tráfego entre regiões.

### D. Autorizar administradora e liberar alimentos

1. No Firebase Console → **Authentication → Users**, crie a conta da administradora com e-mail e senha forte. Copie o **UID**.
2. No **Firestore → Dados**, crie a coleção `admins`. Crie um documento cujo **ID seja exatamente o UID**. Crie o campo `active` como **boolean** e valor `true`.
3. Abra `https://seu-projeto.vercel.app/admin` e entre com os dados cadastrados.
4. Na aba **Alimentos**, clique em **Cadastrar os 26 alimentos**.
5. Defina manualmente a quantidade total e a quantidade por confirmação para cada alimento e salve. O total inicial é **zero** — nada fica disponível até a organização preencher.
6. Abra o convite e faça uma confirmação real para conferir o registro no painel. Se não quiser que a confirmação de verificação fique contabilizada, **não divulgue o link antes de testar**; esta versão não inclui exclusão de confirmações.

## Funcionalidades preservadas

- Convite original de **17/10, sábado, a partir das 13 horas**, com arte intacta.
- Botão de localização do Google Maps e botão de confirmação sobre a arte.
- Confirmação com até **12 acompanhantes**; somente **uma cota de alimento por confirmação**.
- **26 alimentos** pré-cadastráveis + adição de novos; saldo e porção definidos pelo admin.
- Transações Firestore impedem reservar a última porção duas vezes ao mesmo tempo.
- Painel protegido com Firebase Authentication e autorização `admins/{uid}`.
- Lista de convidados e acompanhantes, indicadores, busca e **exportação CSV**.
- Vídeo original `confirmacao.mp4` somente após a confirmação gravada, com áudio e sem loop (navegadores podem solicitar toque para iniciar áudio).

## Segurança e observações

- Regras Firestore bloqueiam acesso direto de visitantes; o painel acessa os dados pelas Cloud Functions que checam autorização.
- A Vercel recebe **somente** os arquivos de `public/`, nunca `functions/`, regras ou arquivos internos.
- Não inclua senhas nem credenciais privadas em `firebase-config.js` ou no GitHub. Nunca suba o arquivo de credenciais de conta de serviço.
- O Firebase Anonymous Auth e a Cloud Function pública podem ser alvo de abusos. Antes de ampla divulgação, configure o [Firebase App Check](https://firebase.google.com/docs/app-check/web/recaptcha-provider) e depois habilite `enforceAppCheck` na função pública. Não habilite no backend antes do frontend, para não bloquear os convidados.
- Para evitar excesso de gasto, configure alertas de orçamento no Google Cloud. A Vercel e o Firebase podem ter limites e custos conforme planos e uso.
- Não há importação automática de dados anteriores em PHP. Não há banco falso, painel aberto ou senha embutida no site.

## Manutenção

- Alterar arte/horário, botão, textos ou a configuração pública: editar `public/` no GitHub; a Vercel republica.
- Alterar backend, validações, reservas, regras: editar `functions/`, `firestore.rules` ou `firebase.json` e **executar novamente** o `firebase deploy --only functions,firestore` (o deploy na Vercel sozinho não atualiza o backend).
- Trocar o ponto exato do local: `public/index.html` → `urlLocal`.
- Verificar estrutura local sem dependências: `node scripts/validar.mjs` (Node.js 20+).

**Separação importante: GitHub guarda o código; Vercel publica a interface; Firebase guarda os dados quando você ativar.**
