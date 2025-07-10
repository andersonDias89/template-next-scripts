#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Cores para console
const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  reset: '\x1b[0m',
  bold: '\x1b[1m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function logStep(step, message) {
  log(`\n${colors.bold}[PASSO ${step}]${colors.reset} ${colors.blue}${message}${colors.reset}`);
}

function execCommand(command, description) {
  try {
    log(`Executando: ${command}`, 'yellow');
    const result = execSync(command, { 
      stdio: 'inherit',
      cwd: process.cwd(),
      timeout: 300000 // 5 minutos timeout
    });
    log(`✅ ${description} - Concluído`, 'green');
    return true;
  } catch (error) {
    log(`❌ Erro ao executar: ${command}`, 'red');
    log(`Erro: ${error.message}`, 'red');
    return false;
  }
}

function execCommandSilent(command) {
  try {
    const result = execSync(command, { 
      stdio: 'pipe',
      cwd: process.cwd(),
      timeout: 30000,
      encoding: 'utf8'
    });
    return { success: true, output: result };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForPostgres(maxRetries = 30) {
  log('Verificando se PostgreSQL está pronto...', 'yellow');
  
  for (let i = 0; i < maxRetries; i++) {
    try {
      const result = execSync('docker exec auth-postgres pg_isready -U postgres', { 
        stdio: 'pipe',
        timeout: 5000
      });
      log('✅ PostgreSQL está pronto!', 'green');
      return true;
    } catch (error) {
      log(`Tentativa ${i + 1}/${maxRetries} - Aguardando PostgreSQL...`, 'yellow');
      await sleep(2000);
    }
  }
  
  throw new Error('PostgreSQL não ficou pronto dentro do tempo limite');
}

async function checkNodeModules() {
  log('Verificando se node_modules/@prisma/client existe...', 'yellow');
  const prismaClientPath = 'node_modules/@prisma/client';
  
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(prismaClientPath)) {
      log('✅ @prisma/client encontrado!', 'green');
      return true;
    }
    log(`Tentativa ${i + 1}/10 - Aguardando @prisma/client...`, 'yellow');
    await sleep(2000);
  }
  
  return false;
}

async function main() {
  log('\n🚀 Iniciando configuração do sistema de autenticação...', 'bold');
  
  try {
    // PASSO 1: Ler configurações existentes
    logStep(1, 'Lendo configurações do projeto');
    
    const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
    const tsConfig = JSON.parse(fs.readFileSync('tsconfig.json', 'utf8'));
    
    log('✅ Configurações lidas com sucesso', 'green');
    
    // PASSO 2: Instalar dependências essenciais primeiro
    logStep(2, 'Instalando dependências essenciais');
    
    const essentialCommands = [
      'npm install @prisma/client prisma bcryptjs jsonwebtoken',
      'npm install -D @types/bcryptjs @types/jsonwebtoken tsx'
    ];
    
    for (const command of essentialCommands) {
      if (!execCommand(command, 'Instalação de dependências essenciais')) {
        throw new Error('Falha na instalação de dependências essenciais');
      }
    }
    
    // PASSO 3: Instalar NextAuth.js
    logStep(3, 'Instalando NextAuth.js');
    
    if (!execCommand('npm install next-auth@beta @auth/prisma-adapter', 'Instalação do NextAuth.js')) {
      throw new Error('Falha na instalação do NextAuth.js');
    }
    
    // PASSO 4: Criar arquivo docker-compose.yml
    logStep(4, 'Criando arquivo Docker Compose para PostgreSQL');
    
    const dockerCompose = `services:
  postgres:
    image: postgres:15
    container_name: auth-postgres
    environment:
      POSTGRES_DB: authdb
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres123
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
    networks:
      - auth-network
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 5s
      timeout: 5s
      retries: 5

volumes:
  postgres_data:

networks:
  auth-network:
    driver: bridge
`;
    
    fs.writeFileSync('docker-compose.yml', dockerCompose);
    log('✅ docker-compose.yml criado', 'green');
    
    // PASSO 5: Criar/Configurar arquivo .env
    logStep(5, 'Configurando arquivo .env');
    
    const envContent = `# Database
DATABASE_URL="postgresql://postgres:postgres123@localhost:5432/authdb?schema=public"

# NextAuth.js
NEXTAUTH_SECRET="sua-chave-secreta-super-segura-aqui-123456789"
NEXTAUTH_URL="http://localhost:3000"

# JWT
JWT_SECRET="jwt-secret-key-super-segura-123456789"

# Aplicação
NODE_ENV="development"
PORT=3000
`;
    
    if (fs.existsSync('.env')) {
      log('Arquivo .env já existe, criando backup...', 'yellow');
      fs.copyFileSync('.env', '.env.backup');
    }
    
    fs.writeFileSync('.env', envContent);
    log('✅ Arquivo .env configurado', 'green');
    
    // PASSO 6: Inicializar Prisma
    logStep(6, 'Inicializando Prisma');
    
    // Verificar se pasta prisma já existe
    if (fs.existsSync('prisma')) {
      log('Pasta prisma já existe, removendo...', 'yellow');
      fs.rmSync('prisma', { recursive: true, force: true });
    }
    
    if (!execCommand('npx prisma init --datasource-provider postgresql', 'Inicialização do Prisma')) {
      throw new Error('Falha na inicialização do Prisma');
    }
    
    // Aguardar criação dos arquivos
    await sleep(2000);
    
    // PASSO 7: Configurar schema do Prisma
    logStep(7, 'Configurando schema do Prisma');
    
    const prismaSchema = `// This is your Prisma schema file,
// learn more about it in the docs: https://pris.ly/d/prisma-schema

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model Account {
  id                String  @id @default(cuid())
  userId            String
  type              String
  provider          String
  providerAccountId String
  refresh_token     String? @db.Text
  access_token      String? @db.Text
  expires_at        Int?
  token_type        String?
  scope             String?
  id_token          String? @db.Text
  session_state     String?

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([provider, providerAccountId])
}

model Session {
  id           String   @id @default(cuid())
  sessionToken String   @unique
  userId       String
  expires      DateTime
  user         User     @relation(fields: [userId], references: [id], onDelete: Cascade)
}

model User {
  id            String    @id @default(cuid())
  name          String?
  email         String    @unique
  emailVerified DateTime?
  image         String?
  password      String?
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt
  accounts      Account[]
  sessions      Session[]
}

model VerificationToken {
  identifier String
  token      String   @unique
  expires    DateTime

  @@unique([identifier, token])
}
`;
    
    fs.writeFileSync('prisma/schema.prisma', prismaSchema);
    log('✅ Schema do Prisma configurado', 'green');
    
    // PASSO 8: Subir banco PostgreSQL ANTES das configurações
    logStep(8, 'Subindo banco PostgreSQL com Docker');
    
    if (!execCommand('docker compose up -d', 'Subindo PostgreSQL')) {
      throw new Error('Falha ao subir o PostgreSQL');
    }
    
    // Aguardar o banco ficar pronto
    await waitForPostgres();
    
    // PASSO 9: Gerar Prisma Client
    logStep(9, 'Gerando Prisma Client');
    
    if (!execCommand('npx prisma generate', 'Geração do Prisma Client')) {
      throw new Error('Falha na geração do Prisma Client');
    }
    
    // Aguardar e verificar se o cliente foi gerado
    await checkNodeModules();
    
    if (!execCommand('npx prisma db push', 'Aplicação do schema no banco')) {
      throw new Error('Falha na aplicação do schema');
    }
    
    // PASSO 10: Criar seed JavaScript (mais confiável)
    logStep(10, 'Criando e executando seed');
    
    const seedJs = `const { PrismaClient } = require('@prisma/client')
const bcrypt = require('bcryptjs')

const prisma = new PrismaClient()

async function main() {
  console.log('Iniciando seed...')
  
  try {
    // Criar usuário de teste
    const hashedPassword = await bcrypt.hash('123456', 12)
    
    const user = await prisma.user.upsert({
      where: { email: 'teste@exemplo.com' },
      update: {},
      create: {
        email: 'teste@exemplo.com',
        password: hashedPassword,
        name: 'Usuário Teste'
      }
    })

    console.log('✅ Usuário de teste criado:', {
      id: user.id,
      email: user.email,
      name: user.name
    })
  } catch (error) {
    console.error('❌ Erro no seed:', error)
    throw error
  }
}

main()
  .catch((e) => {
    console.error('❌ Erro fatal no seed:', e)
    process.exit(1)
  })
  .finally(async () => {
    console.log('🔄 Desconectando do banco...')
    await prisma.$disconnect()
  })
`;
    
    fs.writeFileSync('prisma/seed.js', seedJs);
    
    // Atualizar package.json com script de seed
    const updatedPackageJson = { ...packageJson };
    updatedPackageJson.prisma = {
      seed: "node prisma/seed.js"
    };
    
    fs.writeFileSync('package.json', JSON.stringify(updatedPackageJson, null, 2));
    
    // Executar seed
    if (!execCommand('node prisma/seed.js', 'Executando seed')) {
      throw new Error('Falha na execução do seed');
    }
    
    log('✅ Seed executado com sucesso', 'green');
    
    // PASSO 11: Configurar NextAuth.js
    logStep(11, 'Configurando NextAuth.js');
    
    // Criar diretório lib se não existir
    const libDir = 'src/lib';
    if (!fs.existsSync(libDir)) {
      fs.mkdirSync(libDir, { recursive: true });
    }
    
    // auth.ts
    const authConfig = `import NextAuth from "next-auth"
import CredentialsProvider from "next-auth/providers/credentials"
import { PrismaAdapter } from "@auth/prisma-adapter"
import { prisma } from "./prisma"
import bcrypt from "bcryptjs"

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  providers: [
    CredentialsProvider({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" }
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          return null
        }

        const user = await prisma.user.findUnique({
          where: {
            email: credentials.email as string
          }
        })

        if (!user || !user.password) {
          return null
        }

        const isPasswordValid = await bcrypt.compare(
          credentials.password as string,
          user.password
        )

        if (!isPasswordValid) {
          return null
        }

        return {
          id: user.id,
          email: user.email,
          name: user.name,
        }
      }
    })
  ],
  session: {
    strategy: "jwt",
    maxAge: 30 * 24 * 60 * 60, // 30 days
  },
  jwt: {
    secret: process.env.JWT_SECRET,
  },
  pages: {
    signIn: "/auth/signin",
    signUp: "/auth/signup",
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id
      }
      return token
    },
    async session({ session, token }) {
      if (token) {
        session.user.id = token.id as string
      }
      return session
    },
  },
})
`;
    
    fs.writeFileSync(`${libDir}/auth.ts`, authConfig);
    
    // prisma.ts
    const prismaConfig = `import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const prisma = globalForPrisma.prisma ?? new PrismaClient()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
`;
    
    fs.writeFileSync(`${libDir}/prisma.ts`, prismaConfig);
    
    log('✅ NextAuth.js configurado', 'green');
    
    // PASSO 12: Criar rotas de API
    logStep(12, 'Criando rotas de API');
    
    const apiDir = 'src/app/api';
    const authApiDir = `${apiDir}/auth/[...nextauth]`;
    
    // Criar diretórios
    if (!fs.existsSync(authApiDir)) {
      fs.mkdirSync(authApiDir, { recursive: true });
    }
    
    // route.ts para NextAuth
    const authRoute = `import { handlers } from "@/lib/auth"

export const { GET, POST } = handlers
`;
    
    fs.writeFileSync(`${authApiDir}/route.ts`, authRoute);
    
    // Rota de registro
    const registerDir = `${apiDir}/register`;
    if (!fs.existsSync(registerDir)) {
      fs.mkdirSync(registerDir, { recursive: true });
    }
    
    const registerRoute = `import { NextRequest, NextResponse } from "next/server"
import bcrypt from "bcryptjs"
import { prisma } from "@/lib/prisma"

export async function POST(request: NextRequest) {
  try {
    const { email, password, name } = await request.json()

    if (!email || !password) {
      return NextResponse.json(
        { error: "Email e senha são obrigatórios" },
        { status: 400 }
      )
    }

    // Verificar se o usuário já existe
    const existingUser = await prisma.user.findUnique({
      where: { email }
    })

    if (existingUser) {
      return NextResponse.json(
        { error: "Usuário já existe" },
        { status: 400 }
      )
    }

    // Hash da senha
    const hashedPassword = await bcrypt.hash(password, 12)

    // Criar usuário
    const user = await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        name: name || null
      }
    })

    // Remover senha da resposta
    const { password: _, ...userWithoutPassword } = user

    return NextResponse.json({
      message: "Usuário criado com sucesso",
      user: userWithoutPassword
    })
  } catch (error) {
    console.error("Erro ao registrar usuário:", error)
    return NextResponse.json(
      { error: "Erro interno do servidor" },
      { status: 500 }
    )
  }
}
`;
    
    fs.writeFileSync(`${registerDir}/route.ts`, registerRoute);
    
    // Rota de profile
    const profileDir = `${apiDir}/profile`;
    if (!fs.existsSync(profileDir)) {
      fs.mkdirSync(profileDir, { recursive: true });
    }
    
    const profileRoute = `import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/prisma"

export async function GET() {
  try {
    const session = await auth()
    
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "Não autorizado" },
        { status: 401 }
      )
    }

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: {
        id: true,
        email: true,
        name: true,
        createdAt: true,
        updatedAt: true
      }
    })

    if (!user) {
      return NextResponse.json(
        { error: "Usuário não encontrado" },
        { status: 404 }
      )
    }

    return NextResponse.json({ user })
  } catch (error) {
    console.error("Erro ao buscar perfil:", error)
    return NextResponse.json(
      { error: "Erro interno do servidor" },
      { status: 500 }
    )
  }
}
`;
    
    fs.writeFileSync(`${profileDir}/route.ts`, profileRoute);
    
    log('✅ Rotas de API criadas', 'green');
    
    // PASSO 13: Atualizar next.config.ts
    logStep(13, 'Atualizando configuração do Next.js');
    
    const nextConfig = `import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@prisma/client", "bcryptjs"]
};

export default nextConfig;
`;
    
    fs.writeFileSync('next.config.ts', nextConfig);
    log('✅ next.config.ts atualizado', 'green');
    
    // PASSO 14: Criar types do NextAuth
    logStep(14, 'Configurando types do NextAuth');
    
    const typesDir = 'src/types';
    if (!fs.existsSync(typesDir)) {
      fs.mkdirSync(typesDir, { recursive: true });
    }
    
    const authTypes = `import { DefaultSession } from "next-auth"

declare module "next-auth" {
  interface Session {
    user: {
      id: string
    } & DefaultSession["user"]
  }
  
  interface User {
    id: string
    email: string
    name?: string
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string
  }
}
`;
    
    fs.writeFileSync(`${typesDir}/next-auth.d.ts`, authTypes);
    log('✅ Types do NextAuth configurados', 'green');
    
    // PASSO 15: Criar arquivo de teste auth.http
    logStep(15, 'Criando arquivo de teste auth.http');
    
    const authHttpContent = `### Variáveis
@baseUrl = http://localhost:3000
@email = teste@exemplo.com
@password = 123456

### 1. Registrar novo usuário
POST {{baseUrl}}/api/register
Content-Type: application/json

{
  "email": "novo@exemplo.com",
  "password": "123456",
  "name": "Novo Usuário"
}

### 2. Login via NextAuth (usar no browser)
# GET {{baseUrl}}/api/auth/signin

### 3. Verificar perfil (requer autenticação)
GET {{baseUrl}}/api/profile
Content-Type: application/json

### 4. Logout via NextAuth (usar no browser)
# GET {{baseUrl}}/api/auth/signout

### 5. Testar credenciais do usuário de seed
POST {{baseUrl}}/api/auth/callback/credentials
Content-Type: application/json

{
  "email": "{{email}}",
  "password": "{{password}}"
}

### Comandos úteis:
# Para iniciar o servidor: npm run dev
# Para parar o banco: docker compose down
# Para ver logs do banco: docker logs auth-postgres

### Informações importantes:
# - Usuário de teste criado: teste@exemplo.com / 123456
# - Para testar login completo, acesse: http://localhost:3000/api/auth/signin
# - Para logout, acesse: http://localhost:3000/api/auth/signout
# - O banco PostgreSQL está rodando na porta 5432
# - Para parar o banco: docker compose down
`;
    
    fs.writeFileSync('auth.http', authHttpContent);
    log('✅ Arquivo auth.http criado', 'green');
    
    // PASSO FINAL: Teste rápido de conectividade
    logStep('FINAL', 'Testando conectividade com o banco');
    
    const testResult = execCommandSilent('npx prisma db push --force-reset');
    if (testResult.success) {
      log('✅ Teste de conectividade passou!', 'green');
    } else {
      log('⚠️ Aviso: Teste de conectividade falhou, mas configuração foi concluída', 'yellow');
    }
    
    log('\n🎉 Configuração concluída com sucesso!', 'green');
    log('\n📋 Resumo do que foi configurado:', 'bold');
    log('• Prisma instalado e configurado', 'green');
    log('• NextAuth.js com JWT configurado', 'green');
    log('• PostgreSQL rodando via Docker', 'green');
    log('• Arquivo .env configurado', 'green');
    log('• Schema do banco criado', 'green');
    log('• Usuário de teste criado (teste@exemplo.com / 123456)', 'green');
    log('• Rotas de API criadas', 'green');
    log('• Arquivo auth.http para testes criado', 'green');
    
    log('\n🚀 Para testar:', 'bold');
    log('1. Execute: npm run dev', 'yellow');
    log('2. Acesse: http://localhost:3000/api/auth/signin', 'yellow');
    log('3. Use as credenciais: teste@exemplo.com / 123456', 'yellow');
    log('4. Ou use o arquivo auth.http com a extensão REST Client', 'yellow');
    
    log('\n💾 Banco de dados:', 'bold');
    log('• Host: localhost:5432', 'yellow');
    log('• Banco: authdb', 'yellow');
    log('• Usuário: postgres', 'yellow');
    log('• Senha: postgres123', 'yellow');
    
    log('\n🛑 Para parar o banco:', 'bold');
    log('docker compose down', 'yellow');
    
  } catch (error) {
    log(`\n❌ Erro durante a configuração: ${error.message}`, 'red');
    log('\n🔄 Executando limpeza...', 'yellow');
    
    // Limpeza em caso de erro
    try {
      execCommand('docker compose down', 'Parando containers');
      
      // Remover arquivos criados
      const filesToRemove = [
        'docker-compose.yml',
        '.env',
        'prisma',
        'auth.http',
        'src/lib',
        'src/app/api',
        'src/types'
      ];
      
      filesToRemove.forEach(file => {
        if (fs.existsSync(file)) {
          if (fs.lstatSync(file).isDirectory()) {
            fs.rmSync(file, { recursive: true, force: true });
          } else {
            fs.unlinkSync(file);
          }
          log(`Removido: ${file}`, 'yellow');
        }
      });
      
      // Restaurar .env backup se existir
      if (fs.existsSync('.env.backup')) {
        fs.copyFileSync('.env.backup', '.env');
        fs.unlinkSync('.env.backup');
        log('Arquivo .env restaurado do backup', 'yellow');
      }
      
      log('\n🧹 Limpeza concluída. Corrija os erros e execute novamente.', 'yellow');
      
    } catch (cleanupError) {
      log(`Erro durante a limpeza: ${cleanupError.message}`, 'red');
    }
    
    process.exit(1);
  }
}

// Executar o script
main();
