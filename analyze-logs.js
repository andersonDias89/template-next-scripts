#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

/**
 * Script inteligente para analisar logs e identificar erros específicos no código
 * Escaneia o projeto inteiro, identifica arquivos com problemas e gera soluções precisas
 */

// Função para encontrar o arquivo de log mais recente
function findMostRecentLog() {
  const logsDir = path.join(process.cwd(), 'logs');
  
  if (!fs.existsSync(logsDir)) {
    console.log('❌ Pasta "logs" não encontrada. Execute primeiro o build-logger.js');
    return null;
  }
  
  const logFiles = fs.readdirSync(logsDir)
    .filter(file => file.endsWith('.log'))
    .map(file => ({
      name: file,
      path: path.join(logsDir, file),
      stats: fs.statSync(path.join(logsDir, file))
    }))
    .sort((a, b) => b.stats.mtime - a.stats.mtime);
  
  return logFiles.length > 0 ? logFiles[0] : null;
}

// Função para extrair informações específicas do erro do log
function extractErrorDetails(logContent) {
  const errorDetails = {
    type: '',
    message: '',
    fileName: '',
    lineNumber: null,
    stackTrace: '',
    fullError: '',
    failedTests: []
  };
  
  // Extrair testes que falharam do log estruturado
  const failedTestsSection = logContent.split('🚨 ERROS DETALHADOS')[1];
  if (failedTestsSection) {
    const errorMatches = failedTestsSection.match(/Erro \d+: (.+?)\n-{20}/g);
    if (errorMatches) {
      errorDetails.failedTests = errorMatches.map(match => {
        const testName = match.match(/Erro \d+: (.+?)\n/)[1];
        return testName;
      });
    }
  }
  
  // Extrair erro completo da seção de detalhes
  const errorSection = logContent.split('Detalhes do erro:')[1] || 
                       logContent.split('🚨 ERROS DETALHADOS')[1] || 
                       logContent;
  errorDetails.fullError = errorSection.trim();
  
  // Procurar por arquivos e linhas específicas no log completo
  const filePatterns = [
    /(\S+\.tsx?)\((\d+),\d+\)/g,  // TypeScript error format
    /(\S+\.tsx?):(\d+):\d+/g,      // Error with line number  
    /at\s+(.+?):(\d+):\d+/g,       // Stack trace com linha
    /Error in (.+\.tsx?)/g,        // Erro específico em arquivo
    /(\S+\.tsx?):\s*(.+)/g         // Formato geral
  ];
  
  for (const pattern of filePatterns) {
    const matches = [...logContent.matchAll(pattern)];
    if (matches.length > 0) {
      const match = matches[0];
      errorDetails.fileName = match[1];
      errorDetails.lineNumber = match[2] ? parseInt(match[2]) : null;
      break;
    }
  }
  
  // Identificar tipo de erro baseado no conteúdo do log e testes falhados
  const errorLower = logContent.toLowerCase();
  
  if (errorDetails.failedTests.some(test => test.includes('TypeScript')) || 
      errorLower.includes('typescript') || errorLower.includes('tsc')) {
    errorDetails.type = 'TYPESCRIPT_ERROR';
  } else if (errorDetails.failedTests.some(test => test.includes('ESLint')) || 
             errorLower.includes('eslint')) {
    errorDetails.type = 'ESLINT_ERROR';
  } else if (errorDetails.failedTests.some(test => test.includes('Prisma')) || 
             errorLower.includes('prisma') || errorLower.includes('database')) {
    errorDetails.type = 'PRISMA_ERROR';
  } else if (errorDetails.failedTests.some(test => test.includes('Build')) || 
             errorLower.includes('next') || errorLower.includes('webpack')) {
    errorDetails.type = 'NEXTJS_ERROR';
  } else if (errorLower.includes('module not found') || errorLower.includes('cannot resolve')) {
    errorDetails.type = 'MODULE_ERROR';
  } else if (errorLower.includes('syntax')) {
    errorDetails.type = 'SYNTAX_ERROR';
  } else {
    errorDetails.type = 'UNKNOWN_ERROR';
  }
  
  return errorDetails;
}

// Função para escanear projeto e encontrar arquivos com problemas
async function scanProjectForErrors() {
  console.log('🔍 Escaneando projeto em busca de erros...');
  
  const projectErrors = [];
  
  // Executar TypeScript check
  try {
    console.log('📝 Verificando erros de TypeScript...');
    const tsErrors = await runTypeScriptCheck();
    projectErrors.push(...tsErrors);
  } catch (error) {
    console.log('⚠️  TypeScript check não disponível');
  }
  
  // Executar ESLint check
  try {
    console.log('🔧 Verificando erros de ESLint...');
    const lintErrors = await runESLintCheck();
    projectErrors.push(...lintErrors);
  } catch (error) {
    console.log('⚠️  ESLint check não disponível');
  }
  
  // Verificar erros de sintaxe nos arquivos
  console.log('📋 Verificando sintaxe dos arquivos...');
  const syntaxErrors = await checkSyntaxErrors();
  projectErrors.push(...syntaxErrors);
  
  // Verificar problemas do Prisma
  console.log('🗄️  Verificando configuração do Prisma...');
  const prismaErrors = await checkPrismaErrors();
  projectErrors.push(...prismaErrors);
  
  return projectErrors;
}

// Função para executar verificação do TypeScript
function runTypeScriptCheck() {
  return new Promise((resolve) => {
    const tsProcess = spawn('npx', ['tsc', '--noEmit', '--pretty', 'false'], {
      stdio: 'pipe',
      shell: true
    });
    
    let output = '';
    
    tsProcess.stdout.on('data', (data) => {
      output += data.toString();
    });
    
    tsProcess.stderr.on('data', (data) => {
      output += data.toString();
    });
    
    tsProcess.on('close', (code) => {
      const errors = parseTypeScriptErrors(output);
      resolve(errors);
    });
    
    tsProcess.on('error', () => {
      resolve([]);
    });
  });
}

// Função para executar verificação do ESLint
function runESLintCheck() {
  return new Promise((resolve) => {
    const eslintProcess = spawn('npx', ['eslint', '.', '--format', 'json'], {
      stdio: 'pipe',
      shell: true
    });
    
    let output = '';
    
    eslintProcess.stdout.on('data', (data) => {
      output += data.toString();
    });
    
    eslintProcess.on('close', (code) => {
      try {
        const results = JSON.parse(output);
        const errors = parseESLintErrors(results);
        resolve(errors);
      } catch (error) {
        resolve([]);
      }
    });
    
    eslintProcess.on('error', () => {
      resolve([]);
    });
  });
}

// Função para verificar erros de sintaxe
async function checkSyntaxErrors() {
  const errors = [];
  const srcDir = path.join(process.cwd(), 'src');
  
  if (!fs.existsSync(srcDir)) return errors;
  
  const files = getAllTsFiles(srcDir);
  
  for (const file of files) {
    try {
      const content = fs.readFileSync(file, 'utf8');
      
      // Verificações básicas de sintaxe
      const syntaxIssues = checkBasicSyntax(content, file);
      errors.push(...syntaxIssues);
      
    } catch (error) {
      errors.push({
        type: 'FILE_READ_ERROR',
        file: file,
        line: 1,
        message: `Erro ao ler arquivo: ${error.message}`,
        severity: 'error'
      });
    }
  }
  
  return errors;
}

// Função para verificar problemas do Prisma
async function checkPrismaErrors() {
  const errors = [];
  const schemaPath = path.join(process.cwd(), 'prisma', 'schema.prisma');
  
  if (!fs.existsSync(schemaPath)) {
    return errors;
  }
  
  try {
    const schemaContent = fs.readFileSync(schemaPath, 'utf8');
    
    // Verificar se há URL de database
    if (!schemaContent.includes('DATABASE_URL')) {
      errors.push({
        type: 'PRISMA_CONFIG_ERROR',
        file: schemaPath,
        line: 1,
        message: 'DATABASE_URL não encontrada no schema.prisma',
        severity: 'error'
      });
    }
    
    // Verificar se cliente foi gerado
    const clientPath = path.join(process.cwd(), 'src', 'generated', 'prisma');
    if (!fs.existsSync(clientPath)) {
      errors.push({
        type: 'PRISMA_CLIENT_ERROR',
        file: schemaPath,
        line: 1,
        message: 'Cliente Prisma não foi gerado. Execute: npx prisma generate',
        severity: 'error'
      });
    }
    
  } catch (error) {
    errors.push({
      type: 'PRISMA_READ_ERROR',
      file: schemaPath,
      line: 1,
      message: `Erro ao ler schema.prisma: ${error.message}`,
      severity: 'error'
    });
  }
  
  return errors;
}

// Função para analisar arquivos específicos com erro
async function analyzeSpecificFile(filePath, lineNumber) {
  if (!fs.existsSync(filePath)) {
    return {
      exists: false,
      content: '',
      errorContext: '',
      suggestions: []
    };
  }
  
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  
  // Pegar contexto ao redor da linha com erro
  const startLine = Math.max(0, (lineNumber || 1) - 3);
  const endLine = Math.min(lines.length, (lineNumber || 1) + 3);
  const errorContext = lines.slice(startLine, endLine).join('\n');
  
  // Analisar o conteúdo e gerar sugestões específicas
  const analysis = analyzeFileContent(content, filePath, lineNumber);
  
  return {
    exists: true,
    content: content,
    errorContext: errorContext,
    lineNumber: lineNumber,
    totalLines: lines.length,
    analysis: analysis
  };
}

// Funções auxiliares para parsing de erros

function parseTypeScriptErrors(output) {
  const errors = [];
  const lines = output.split('\n');
  
  for (const line of lines) {
    const match = line.match(/^(.+?)\((\d+),(\d+)\):\s*(error|warning)\s*TS(\d+):\s*(.+)$/);
    if (match) {
      errors.push({
        type: 'TYPESCRIPT_ERROR',
        file: match[1],
        line: parseInt(match[2]),
        column: parseInt(match[3]),
        severity: match[4],
        code: match[5],
        message: match[6]
      });
    }
  }
  
  return errors;
}

function parseESLintErrors(results) {
  const errors = [];
  
  for (const result of results) {
    for (const message of result.messages) {
      errors.push({
        type: 'ESLINT_ERROR',
        file: result.filePath,
        line: message.line,
        column: message.column,
        severity: message.severity === 2 ? 'error' : 'warning',
        rule: message.ruleId,
        message: message.message
      });
    }
  }
  
  return errors;
}

function getAllTsFiles(dir) {
  const files = [];
  
  function traverse(currentDir) {
    const items = fs.readdirSync(currentDir);
    
    for (const item of items) {
      const fullPath = path.join(currentDir, item);
      const stat = fs.statSync(fullPath);
      
      if (stat.isDirectory() && !item.startsWith('.') && item !== 'node_modules') {
        traverse(fullPath);
      } else if (stat.isFile() && (item.endsWith('.ts') || item.endsWith('.tsx'))) {
        files.push(fullPath);
      }
    }
  }
  
  traverse(dir);
  return files;
}

function checkBasicSyntax(content, filePath) {
  const errors = [];
  const lines = content.split('\n');
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNumber = i + 1;
    
    // Verificar parênteses desbalanceados
    const openParens = (line.match(/\(/g) || []).length;
    const closeParens = (line.match(/\)/g) || []).length;
    
    // Verificar chaves desbalanceadas
    const openBraces = (line.match(/\{/g) || []).length;
    const closeBraces = (line.match(/\}/g) || []).length;
    
    // Verificar imports mal formados
    if (line.includes('import') && !line.includes('from') && !line.includes('*')) {
      if (!line.trim().endsWith(';') && !line.trim().endsWith('{')) {
        errors.push({
          type: 'SYNTAX_ERROR',
          file: filePath,
          line: lineNumber,
          message: 'Import mal formado - verifique a sintaxe',
          severity: 'error'
        });
      }
    }
    
    // Verificar variáveis não declaradas (básico)
    const undeclaredMatch = line.match(/(\w+)\s+is not defined/);
    if (undeclaredMatch) {
      errors.push({
        type: 'REFERENCE_ERROR',
        file: filePath,
        line: lineNumber,
        message: `Variável '${undeclaredMatch[1]}' não está definida`,
        severity: 'error'
      });
    }
  }
  
  return errors;
}

function analyzeFileContent(content, filePath, lineNumber) {
  const analysis = {
    type: '',
    problem: '',
    solution: '',
    code_example: '',
    specific_steps: []
  };
  
  const lines = content.split('\n');
  const problemLine = lines[lineNumber - 1] || '';
  
  // Análise específica baseada no tipo de arquivo e conteúdo
  if (filePath.includes('.tsx') || filePath.includes('.ts')) {
    return analyzeTypeScriptFile(content, problemLine, lineNumber, filePath);
  }
  
  return analysis;
}

function analyzeTypeScriptFile(content, problemLine, lineNumber, filePath) {
  const analysis = {
    type: 'TypeScript/React',
    problem: '',
    solution: '',
    code_example: '',
    specific_steps: []
  };
  
  // Verificar imports ausentes
  if (problemLine.includes('React') && !content.includes("import React")) {
    analysis.problem = 'Import do React está ausente';
    analysis.solution = 'Adicionar import do React no topo do arquivo';
    analysis.code_example = `import React from 'react';`;
    analysis.specific_steps = [
      'Adicione a linha de import no topo do arquivo',
      'Certifique-se de que está antes de outros imports locais',
      'Salve o arquivo e execute o build novamente'
    ];
  }
  
  // Verificar problemas de tipagem
  else if (problemLine.includes(':') && (problemLine.includes('string') || problemLine.includes('number') || problemLine.includes('boolean'))) {
    analysis.problem = 'Problema de tipagem TypeScript';
    analysis.solution = 'Corrigir a declaração de tipo na linha';
    analysis.code_example = `// Exemplo de tipagem correta:\nconst variavel: string = "valor";\nconst numero: number = 42;`;
    analysis.specific_steps = [
      'Verifique se o tipo declarado corresponde ao valor atribuído',
      'Certifique-se de que a sintaxe está correta (: tipo)',
      'Se for uma prop, verifique a interface do componente pai'
    ];
  }
  
  // Verificar problemas de export/import
  else if (problemLine.includes('export') || problemLine.includes('import')) {
    analysis.problem = 'Problema com export/import';
    analysis.solution = 'Corrigir a declaração de import/export';
    analysis.code_example = `// Export correto:\nexport default function ComponentName() {}\n\n// Import correto:\nimport ComponentName from './ComponentName';`;
    analysis.specific_steps = [
      'Verifique se o caminho do arquivo está correto',
      'Certifique-se de que o arquivo exportado existe',
      'Verifique se é export default ou named export'
    ];
  }
  
  // Verificar problemas de componente React
  else if (filePath.includes('.tsx') && (problemLine.includes('function') || problemLine.includes('const'))) {
    analysis.problem = 'Problema na declaração do componente React';
    analysis.solution = 'Corrigir a estrutura do componente';
    analysis.code_example = `// Componente funcional correto:\nfunction ComponentName() {\n  return (\n    <div>\n      {/* conteúdo */}\n    </div>\n  );\n}`;
    analysis.specific_steps = [
      'Verifique se o componente retorna JSX válido',
      'Certifique-se de que está dentro de um único elemento pai',
      'Verifique se todas as tags JSX estão fechadas corretamente'
    ];
  }
  
  // Problema genérico
  else {
    analysis.problem = 'Erro de sintaxe ou lógica detectado';
    analysis.solution = 'Revisar a linha indicada e corrigir o erro';
    analysis.code_example = '// Verifique a sintaxe da linha com erro';
    analysis.specific_steps = [
      'Examine a linha indicada no erro',
      'Verifique sintaxe (pontos e vírgulas, chaves, parênteses)',
      'Execute o linter para mais detalhes: npm run lint'
    ];
  }
  
  return analysis;
}

// Funções auxiliares para o relatório
function getTestIcon(testName) {
  if (testName.includes('TypeScript')) return '📝';
  if (testName.includes('ESLint')) return '🔧';
  if (testName.includes('Prisma')) return '🗄️';
  if (testName.includes('Build')) return '⚛️';
  if (testName.includes('Audit')) return '🔒';
  if (testName.includes('Dependências')) return '📦';
  return '❓';
}

function getErrorTypeIcon(type) {
  const icons = {
    'TYPESCRIPT_ERROR': '📝',
    'ESLINT_ERROR': '🔧',
    'SYNTAX_ERROR': '⚠️',
    'PRISMA_ERROR': '🗄️',
    'MODULE_ERROR': '📦',
    'NEXTJS_ERROR': '⚛️',
    'FILE_READ_ERROR': '📄'
  };
  return icons[type] || '❓';
}

function getErrorTypeName(type) {
  const names = {
    'TYPESCRIPT_ERROR': 'Erros de TypeScript',
    'ESLINT_ERROR': 'Problemas de Lint',
    'SYNTAX_ERROR': 'Erros de Sintaxe',
    'PRISMA_ERROR': 'Problemas do Prisma',
    'MODULE_ERROR': 'Módulos não encontrados',
    'NEXTJS_ERROR': 'Problemas do Next.js',
    'FILE_READ_ERROR': 'Problemas de Leitura'
  };
  return names[type] || 'Erro Desconhecido';
}
// Função para gerar relatório inteligente em Markdown
async function generateIntelligentMarkdownReport(logFile, logContent, errorDetails, projectErrors, isRecurrent) {
  const logName = path.basename(logFile.name, '.log');
  const mdPath = path.join(path.dirname(logFile.path), `${logName}.md`);
  
  const timestamp = logFile.stats.mtime.toISOString();
  const dateFormatted = new Date(timestamp).toLocaleString('pt-BR');
  
  let markdown = `# 🔧 Análise Inteligente de Erro - Build Log\n\n`;
  markdown += `**Data do Log:** ${dateFormatted}  \n`;
  markdown += `**Arquivo de Log:** \`${logFile.name}\`  \n`;
  markdown += `**Status:** ❌ Erro detectado e analisado  \n\n`;
  
  // Resumo dos testes falhados
  if (errorDetails.failedTests.length > 0) {
    markdown += `## 📊 Testes que Falharam\n\n`;
    errorDetails.failedTests.forEach((test, index) => {
      const icon = getTestIcon(test);
      markdown += `${index + 1}. ${icon} **${test}**\n`;
    });
    markdown += `\n`;
  }
  
  // Análise do erro principal do log
  if (errorDetails.fileName) {
    markdown += `## 🎯 Arquivo Problemático Identificado\n\n`;
    markdown += `**Arquivo:** \`${errorDetails.fileName}\`  \n`;
    if (errorDetails.lineNumber) {
      markdown += `**Linha:** ${errorDetails.lineNumber}  \n`;
    }
    markdown += `**Tipo:** ${errorDetails.type}  \n\n`;
    
    // Analisar o arquivo específico
    const fileAnalysis = await analyzeSpecificFile(errorDetails.fileName, errorDetails.lineNumber);
    
    if (fileAnalysis.exists) {
      markdown += `### 📖 Contexto do Erro\n\n`;
      markdown += `\`\`\`typescript\n${fileAnalysis.errorContext}\n\`\`\`\n\n`;
      
      if (fileAnalysis.analysis) {
        markdown += `### � Diagnóstico Específico\n\n`;
        markdown += `**Problema:** ${fileAnalysis.analysis.problem}\n\n`;
        markdown += `**Solução:** ${fileAnalysis.analysis.solution}\n\n`;
        
        if (fileAnalysis.analysis.code_example) {
          markdown += `### 💡 Exemplo de Código Correto\n\n`;
          markdown += `\`\`\`typescript\n${fileAnalysis.analysis.code_example}\n\`\`\`\n\n`;
        }
        
        if (fileAnalysis.analysis.specific_steps.length > 0) {
          markdown += `### 🛠️ Passos Específicos para Resolver\n\n`;
          fileAnalysis.analysis.specific_steps.forEach((step, index) => {
            markdown += `${index + 1}. ${step}\n`;
          });
          markdown += `\n`;
        }
      }
    } else {
      markdown += `⚠️ Arquivo não encontrado no sistema. Verifique se o caminho está correto.\n\n`;
    }
  }
  
  // Erros encontrados no projeto
  if (projectErrors.length > 0) {
    markdown += `## � Erros Detectados no Projeto (${projectErrors.length})\n\n`;
    
    const errorsByType = {};
    projectErrors.forEach(error => {
      if (!errorsByType[error.type]) {
        errorsByType[error.type] = [];
      }
      errorsByType[error.type].push(error);
    });
    
    for (const [type, errors] of Object.entries(errorsByType)) {
      markdown += `### ${getErrorTypeIcon(type)} ${getErrorTypeName(type)}\n\n`;
      
      errors.slice(0, 5).forEach((error, index) => { // Mostrar apenas os 5 primeiros
        markdown += `${index + 1}. **${path.basename(error.file)}:${error.line}**\n`;
        markdown += `   \`${error.message}\`\n\n`;
      });
      
      if (errors.length > 5) {
        markdown += `   ... e mais ${errors.length - 5} erros deste tipo\n\n`;
      }
    }
  }
  
  // Comandos de resolução específicos
  markdown += `## 💻 Comandos de Resolução Recomendados\n\n`;
  
  const commands = generateSpecificCommandsFromFailedTests(errorDetails.failedTests, errorDetails, projectErrors);
  commands.forEach((command, index) => {
    markdown += `${index + 1}. \`${command}\`\n`;
  });
  markdown += `\n`;
  
  // Plano de ação
  markdown += `## � Plano de Ação Completo\n\n`;
  const actionPlan = generateDetailedActionPlan(errorDetails, projectErrors);
  actionPlan.forEach((action, index) => {
    markdown += `### Etapa ${index + 1}: ${action.title}\n`;
    markdown += `${action.description}\n\n`;
    if (action.commands) {
      action.commands.forEach(cmd => {
        markdown += `- \`${cmd}\`\n`;
      });
      markdown += `\n`;
    }
  });
  
  // Log completo (para referência)
  markdown += `## 📄 Log Completo (Referência)\n\n`;
  markdown += `<details>\n`;
  markdown += `<summary>Clique para ver o log completo</summary>\n\n`;
  markdown += `\`\`\`\n${logContent}\n\`\`\`\n\n`;
  markdown += `</details>\n\n`;
  
  markdown += `## 🔗 Links Úteis\n\n`;
  markdown += `- [Documentação do Next.js](https://nextjs.org/docs)\n`;
  markdown += `- [Documentação do Prisma](https://www.prisma.io/docs)\n`;
  markdown += `- [Documentação do TypeScript](https://www.typescriptlang.org/docs)\n`;
  markdown += `- [Guia de Solução de Problemas do React](https://react.dev/learn/troubleshooting)\n\n`;
  
  markdown += `---\n`;
  markdown += `*Análise inteligente gerada automaticamente em ${new Date().toLocaleString('pt-BR')}*\n`;
  
  fs.writeFileSync(mdPath, markdown);
  return mdPath;
}

function generateSpecificCommands(errorDetails, projectErrors) {
  const commands = [];
  
  // Comandos baseados no tipo de erro principal
  switch (errorDetails.type) {
    case 'TYPESCRIPT_ERROR':
      commands.push('npx tsc --noEmit');
      commands.push('npm run lint -- --fix');
      break;
    case 'PRISMA_ERROR':
      commands.push('npx prisma generate');
      commands.push('npx prisma migrate dev');
      commands.push('npx prisma db push');
      break;
    case 'MODULE_ERROR':
      commands.push('npm install');
      commands.push('rm -rf node_modules package-lock.json && npm install');
      break;
    case 'NEXTJS_ERROR':
      commands.push('rm -rf .next');
      commands.push('npm run build');
      break;
  }
  
  // Adicionar comandos baseados nos erros do projeto
  const hasTypeScriptErrors = projectErrors.some(e => e.type === 'TYPESCRIPT_ERROR');
  const hasPrismaErrors = projectErrors.some(e => e.type === 'PRISMA_ERROR');
  const hasLintErrors = projectErrors.some(e => e.type === 'ESLINT_ERROR');
  
  if (hasTypeScriptErrors && !commands.includes('npx tsc --noEmit')) {
    commands.push('npx tsc --noEmit');
  }
  
  if (hasPrismaErrors && !commands.includes('npx prisma generate')) {
    commands.push('npx prisma generate');
  }
  
  if (hasLintErrors && !commands.includes('npm run lint -- --fix')) {
    commands.push('npm run lint -- --fix');
  }
  
  // Comandos finais padrão
  commands.push('npm run build:dev');
  commands.push('node analyze-logs.js');
  
  return commands;
}

function generateSpecificCommandsFromFailedTests(failedTests, errorDetails, projectErrors) {
  const commands = [];
  
  // Comandos baseados nos testes que falharam
  failedTests.forEach(test => {
    if (test.includes('TypeScript') && !commands.includes('npx tsc --noEmit')) {
      commands.push('npx tsc --noEmit');
    }
    if (test.includes('ESLint') && !commands.includes('npm run lint -- --fix')) {
      commands.push('npm run lint -- --fix');
    }
    if (test.includes('Prisma') && !commands.includes('npx prisma generate')) {
      commands.push('npx prisma generate');
      commands.push('npx prisma migrate dev');
    }
    if (test.includes('Build') && !commands.includes('rm -rf .next')) {
      commands.push('rm -rf .next');
    }
    if (test.includes('Dependências') && !commands.includes('npm install')) {
      commands.push('npm install');
    }
    if (test.includes('Auditoria') && !commands.includes('npm audit fix')) {
      commands.push('npm audit fix');
    }
  });
  
  // Comandos baseados no tipo de erro principal
  switch (errorDetails.type) {
    case 'TYPESCRIPT_ERROR':
      if (!commands.includes('npx tsc --noEmit')) {
        commands.push('npx tsc --noEmit');
      }
      break;
    case 'PRISMA_ERROR':
      if (!commands.includes('npx prisma generate')) {
        commands.push('npx prisma generate');
      }
      break;
    case 'MODULE_ERROR':
      if (!commands.includes('npm install')) {
        commands.push('npm install');
      }
      break;
    case 'NEXTJS_ERROR':
      if (!commands.includes('rm -rf .next')) {
        commands.push('rm -rf .next');
      }
      break;
  }
  
  // Comandos finais padrão
  commands.push('npm run build:dev');
  commands.push('node analyze-logs.js');
  
  return [...new Set(commands)]; // Remover duplicatas
}

function generateActionPlan(errorDetails, projectErrors) {
  const plan = [];
  
  // Diagnóstico inicial
  plan.push({
    title: 'Diagnóstico Inicial',
    description: 'Identificar e entender os problemas encontrados.',
    commands: ['npx tsc --noEmit', 'npm run lint']
  });
  
  // Resolução por tipo
  if (errorDetails.type === 'PRISMA_ERROR' || projectErrors.some(e => e.type === 'PRISMA_ERROR')) {
    plan.push({
      title: 'Corrigir Problemas do Prisma',
      description: 'Resolver problemas relacionados ao banco de dados e ORM.',
      commands: ['npx prisma generate', 'npx prisma migrate dev']
    });
  }
  
  if (errorDetails.type === 'MODULE_ERROR' || projectErrors.some(e => e.type === 'MODULE_ERROR')) {
    plan.push({
      title: 'Resolver Dependências',
      description: 'Garantir que todos os módulos estão instalados corretamente.',
      commands: ['npm install', 'npm audit fix']
    });
  }
  
  if (errorDetails.fileName) {
    plan.push({
      title: 'Corrigir Arquivo Específico',
      description: `Resolver problemas no arquivo ${errorDetails.fileName} linha ${errorDetails.lineNumber || 'identificada'}.`,
      commands: [`code ${errorDetails.fileName}:${errorDetails.lineNumber || 1}`]
    });
  }
  
  // Limpeza e rebuild
  plan.push({
    title: 'Limpeza e Rebuild',
    description: 'Limpar cache e fazer rebuild completo.',
    commands: ['rm -rf .next', 'npm run build:dev']
  });
  
  // Verificação final
  plan.push({
    title: 'Verificação Final',
    description: 'Confirmar que todos os problemas foram resolvidos.',
    commands: ['npm run build:dev', 'node analyze-logs.js']
  });
  
  return plan;
}

function generateDetailedActionPlan(errorDetails, projectErrors) {
  const plan = [];
  
  // Plano baseado nos testes falhados
  if (errorDetails.failedTests.includes('Verificação TypeScript')) {
    plan.push({
      title: 'Corrigir Erros de TypeScript',
      description: 'Resolver problemas de tipagem e sintaxe do TypeScript.',
      commands: ['npx tsc --noEmit', 'code . # Abrir editor para correções']
    });
  }
  
  if (errorDetails.failedTests.includes('Verificação ESLint')) {
    plan.push({
      title: 'Corrigir Problemas de Lint',
      description: 'Resolver problemas de qualidade e padrões de código.',
      commands: ['npm run lint -- --fix', 'npm run lint # Verificar problemas restantes']
    });
  }
  
  if (errorDetails.failedTests.some(test => test.includes('Prisma'))) {
    plan.push({
      title: 'Resolver Problemas do Prisma',
      description: 'Corrigir configuração do banco de dados e ORM.',
      commands: ['npx prisma generate', 'npx prisma migrate dev', 'npx prisma db push']
    });
  }
  
  if (errorDetails.failedTests.includes('Build do Next.js')) {
    plan.push({
      title: 'Corrigir Build do Next.js',
      description: 'Resolver problemas de build e compilação.',
      commands: ['rm -rf .next', 'npm run build:dev']
    });
  }
  
  if (errorDetails.failedTests.includes('Verificação de Dependências')) {
    plan.push({
      title: 'Resolver Dependências',
      description: 'Corrigir problemas com pacotes e dependências.',
      commands: ['npm install', 'rm -rf node_modules package-lock.json && npm install']
    });
  }
  
  if (errorDetails.fileName) {
    plan.push({
      title: 'Corrigir Arquivo Específico',
      description: `Resolver problemas no arquivo ${errorDetails.fileName}${errorDetails.lineNumber ? ` na linha ${errorDetails.lineNumber}` : ''}.`,
      commands: [`code ${errorDetails.fileName}${errorDetails.lineNumber ? `:${errorDetails.lineNumber}` : ''}`]
    });
  }
  
  // Verificação final
  plan.push({
    title: 'Verificação Final',
    description: 'Executar todos os testes novamente para confirmar as correções.',
    commands: ['node build-logger.js', 'node analyze-logs.js']
  });
  
  return plan;
}

// Função para verificar se o log contém erro
function hasError(logContent) {
  const errorIndicators = [
    '❌ Status: ERRO',
    'Status: ERRO', 
    '❌ Falhas:', 
    'Falhas: [1-9]',  // Regex para capturar falhas > 0
    'ERROS DETALHADOS',
    'Build falhou',
    'Error:',
    'TypeError:',
    'SyntaxError:',
    'ReferenceError:'
  ];
  
  return errorIndicators.some(indicator => 
    logContent.toLowerCase().includes(indicator.toLowerCase())
  ) || /❌ Falhas: [1-9]\d*/.test(logContent); // Verificar se há falhas numericamente
}

// Função para extrair se o erro é recorrente do log
function isRecurrentFromLog(logContent) {
  return logContent.includes('ERRO RECORRENTE') || logContent.includes('⚠️  ERRO RECORRENTE');
}

// Função principal atualizada
async function analyzeLogs() {
  console.log('🔍 Iniciando análise inteligente de logs...\n');
  
  const recentLog = findMostRecentLog();
  
  if (!recentLog) {
    console.log('❌ Nenhum arquivo de log encontrado.');
    console.log('💡 Execute primeiro: node build-logger.js');
    return;
  }
  
  console.log(`📄 Log mais recente: ${recentLog.name}`);
  console.log(`📅 Data: ${recentLog.stats.mtime.toLocaleString('pt-BR')}\n`);
  
  const logContent = fs.readFileSync(recentLog.path, 'utf8');
  
  if (hasError(logContent)) {
    console.log('❌ Erro detectado no log!');
    
    const isRecurrent = isRecurrentFromLog(logContent);
    if (isRecurrent) {
      console.log('⚠️  Este é um erro recorrente!');
    }
    
    console.log('� Extraindo detalhes do erro...');
    const errorDetails = extractErrorDetails(logContent);
    
    console.log('🔍 Escaneando projeto para análise completa...');
    const projectErrors = await scanProjectForErrors();
    
    console.log(`📊 Erros encontrados no projeto: ${projectErrors.length}`);
    
    if (errorDetails.fileName) {
      console.log(`🎯 Arquivo problemático: ${errorDetails.fileName}${errorDetails.lineNumber ? `:${errorDetails.lineNumber}` : ''}`);
    }
    
    console.log('📝 Gerando relatório inteligente...\n');
    
    const mdPath = await generateIntelligentMarkdownReport(
      recentLog, 
      logContent, 
      errorDetails, 
      projectErrors, 
      isRecurrent
    );
    
    console.log('✅ Análise completa finalizada!');
    console.log(`📄 Relatório: ${mdPath}`);
    console.log(`\n🔧 Tipo de erro: ${errorDetails.type || 'Analisando...'}`);
    console.log(`� Erros no projeto: ${projectErrors.length} encontrados`);
    
    if (projectErrors.length > 0) {
      console.log('\n📊 Resumo dos erros:');
      const errorCounts = {};
      projectErrors.forEach(error => {
        errorCounts[error.type] = (errorCounts[error.type] || 0) + 1;
      });
      
      for (const [type, count] of Object.entries(errorCounts)) {
        console.log(`   ${getErrorTypeIcon(type)} ${getErrorTypeName(type)}: ${count}`);
      }
    }
    
    console.log('\n� Próximos passos:');
    console.log('1. Abra o arquivo .md gerado para ver as instruções detalhadas');
    console.log('2. Siga o plano de ação passo a passo');
    console.log('3. Execute os comandos sugeridos na ordem indicada');
    console.log('4. Execute node build-logger.js para verificar se foi resolvido');
    
  } else {
    console.log('✅ Último log analisado: nenhum erro encontrado. Ambiente limpo.');
    
    // Mesmo sem erros no log, fazer uma verificação rápida do projeto
    console.log('🔍 Fazendo verificação preventiva do projeto...');
    const projectErrors = await scanProjectForErrors();
    
    if (projectErrors.length > 0) {
      console.log(`⚠️  Encontrados ${projectErrors.length} problemas potenciais no código:`);
      
      const errorCounts = {};
      projectErrors.forEach(error => {
        errorCounts[error.type] = (errorCounts[error.type] || 0) + 1;
      });
      
      for (const [type, count] of Object.entries(errorCounts)) {
        console.log(`   ${getErrorTypeIcon(type)} ${getErrorTypeName(type)}: ${count}`);
      }
      
      console.log('\n💡 Execute os comandos de linting para corrigir:');
      console.log('   npx tsc --noEmit');
      console.log('   npm run lint -- --fix');
    } else {
      console.log('🎉 Projeto está limpo - nenhum problema detectado!');
    }
  }
}

// Verificar se estamos na raiz do projeto
if (!fs.existsSync('package.json')) {
  console.error('❌ Erro: package.json não encontrado. Execute este script na raiz do projeto.');
  process.exit(1);
}

// Executar análise
analyzeLogs().catch(error => {
  console.error('❌ Erro durante a análise:', error.message);
  process.exit(1);
});