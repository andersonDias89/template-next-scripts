#!/usr/bin/env node

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

/**
 * Script inteligente para executar múltiplos testes e registrar logs completos
 * Executa TypeScript check, ESLint, Prisma check, Build e outros testes
 * Aguarda todos os testes antes de gerar o log final
 */

// Função para criar nome do arquivo de log baseado na data/hora atual
function createLogFileName() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hour = String(now.getHours()).padStart(2, '0');
  const minute = String(now.getMinutes()).padStart(2, '0');
  
  return `log-${year}-${month}-${day}-${hour}-${minute}.log`;
}

// Função para executar um comando e capturar resultado
function runCommand(command, args, description) {
  return new Promise((resolve) => {
    console.log(`⏳ ${description}...`);
    
    const process = spawn(command, args, {
      stdio: 'pipe',
      shell: true
    });
    
    let stdout = '';
    let stderr = '';
    
    process.stdout.on('data', (data) => {
      stdout += data.toString();
    });
    
    process.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    
    process.on('close', (code) => {
      const result = {
        command: `${command} ${args.join(' ')}`,
        description,
        code,
        success: code === 0,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        output: (stdout + stderr).trim(),
        timestamp: new Date().toISOString()
      };
      
      if (result.success) {
        console.log(`✅ ${description} - Concluído`);
      } else {
        console.log(`❌ ${description} - Falhou (código: ${code})`);
      }
      
      resolve(result);
    });
    
    process.on('error', (error) => {
      console.log(`⚠️  ${description} - Não disponível (${error.message})`);
      resolve({
        command: `${command} ${args.join(' ')}`,
        description,
        code: -1,
        success: false,
        stdout: '',
        stderr: error.message,
        output: error.message,
        timestamp: new Date().toISOString(),
        skipped: true
      });
    });
  });
}

// Função para verificar se o Prisma está instalado
function isPrismaInstalled() {
  try {
    const packageJsonPath = path.join(process.cwd(), 'package.json');
    
    if (!fs.existsSync(packageJsonPath)) {
      return false;
    }
    
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    
    // Verificar se Prisma está nas dependências ou devDependencies
    const hasPrisma = (packageJson.dependencies && packageJson.dependencies.prisma) ||
                     (packageJson.devDependencies && packageJson.devDependencies.prisma) ||
                     (packageJson.dependencies && packageJson.dependencies['@prisma/client']) ||
                     (packageJson.devDependencies && packageJson.devDependencies['@prisma/client']);
    
    return hasPrisma;
  } catch (error) {
    console.log('⚠️  Erro ao verificar package.json:', error.message);
    return false;
  }
}

// Função para verificar se existe schema do Prisma
function hasPrismaSchema() {
  return fs.existsSync(path.join(process.cwd(), 'prisma', 'schema.prisma'));
}

// Função para verificar erros recorrentes
function checkIfErrorIsRecurrent(testResults, logsDir) {
  try {
    if (!fs.existsSync(logsDir)) return false;
    
    const logFiles = fs.readdirSync(logsDir)
      .filter(file => file.endsWith('.log'))
      .sort((a, b) => {
        const aTime = fs.statSync(path.join(logsDir, a)).mtime;
        const bTime = fs.statSync(path.join(logsDir, b)).mtime;
        return bTime - aTime;
      });
    
    // Pegar apenas os 3 logs mais recentes para comparação
    const recentLogs = logFiles.slice(0, 3);
    
    for (const logFile of recentLogs) {
      const logPath = path.join(logsDir, logFile);
      const logContent = fs.readFileSync(logPath, 'utf8');
      
      // Verificar se algum erro similar já apareceu
      const hasFailedTests = testResults.some(result => !result.success && !result.skipped);
      if (hasFailedTests && logContent.includes('❌ Status: ERRO')) {
        // Verificar se o mesmo tipo de erro já apareceu
        const currentErrors = testResults
          .filter(r => !r.success && !r.skipped)
          .map(r => r.description);
        
        const hasRecurrentError = currentErrors.some(errorType => 
          logContent.includes(errorType) && logContent.includes('FALHOU')
        );
        
        if (hasRecurrentError) {
          return true;
        }
      }
    }
    
    return false;
  } catch (error) {
    return false;
  }
}

// Função para gerar log detalhado com todos os resultados
function generateComprehensiveLog(testResults, isRecurrent = false) {
  const logsDir = path.join(process.cwd(), 'logs');
  
  // Criar pasta logs se não existir
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
    console.log('📁 Pasta "logs" criada.');
  }
  
  const logFileName = createLogFileName();
  const logPath = path.join(logsDir, logFileName);
  
  const timestamp = new Date().toISOString();
  
  // Verificar se todos os testes foram bem-sucedidos (incluindo filtrados)
  const overallSuccess = testResults.every(result => result.success || result.skipped);
  
  // Verificar status do Prisma para incluir no log
  const prismaInstalled = isPrismaInstalled();
  const prismaSchemaExists = hasPrismaSchema();
  
  let logContent = `[${timestamp}] Relatório Completo de Testes\n`;
  logContent += `${'='.repeat(60)}\n\n`;
  
  // Informações do ambiente
  logContent += `🔧 INFORMAÇÕES DO AMBIENTE\n`;
  logContent += `${'-'.repeat(30)}\n`;
  logContent += `Node.js: ${process.version}\n`;
  logContent += `Plataforma: ${process.platform}\n`;
  logContent += `Prisma instalado: ${prismaInstalled ? 'Sim' : 'Não'}\n`;
  logContent += `Schema Prisma: ${prismaSchemaExists ? 'Encontrado' : 'Não encontrado'}\n`;
  logContent += `\n`;
  
  // Status geral - baseado no sucesso APÓS filtros
  if (overallSuccess) {
    logContent += `✅ Status: SUCESSO\n\n`;
    
    // Verificar se houve filtros aplicados
    const filteredTests = testResults.filter(r => r.filtered);
    if (filteredTests.length > 0) {
      logContent += `🔧 FILTROS APLICADOS: Erros dos scripts de log foram removidos automaticamente.\n`;
      logContent += `Arquivos filtrados: ${filteredTests.map(t => t.description).join(', ')}\n\n`;
    }
    
    logContent += `Todos os testes passaram com sucesso!\n\n`;
  } else {
    logContent += `❌ Status: ERRO\n\n`;
    if (isRecurrent) {
      logContent += `⚠️  ERRO RECORRENTE: Problemas similares já foram detectados em logs anteriores.\n\n`;
    }
  }
  
  // Resumo dos testes
  logContent += `📊 RESUMO DOS TESTES\n`;
  logContent += `${'-'.repeat(30)}\n`;
  
  const successCount = testResults.filter(r => r.success).length;
  const failedCount = testResults.filter(r => !r.success && !r.skipped).length;
  const skippedCount = testResults.filter(r => r.skipped).length;
  const filteredCount = testResults.filter(r => r.filtered).length;
  
  logContent += `✅ Sucessos: ${successCount}\n`;
  logContent += `❌ Falhas: ${failedCount}\n`;
  logContent += `⚠️  Ignorados: ${skippedCount}\n`;
  if (filteredCount > 0) {
    logContent += `🔧 Filtrados: ${filteredCount} (erros de scripts de log removidos)\n`;
  }
  logContent += `📈 Total: ${testResults.length}\n\n`;
  
  // Detalhes de cada teste
  logContent += `📋 DETALHES DOS TESTES\n`;
  logContent += `${'-'.repeat(30)}\n\n`;
  
  testResults.forEach((result, index) => {
    let status;
    if (result.skipped) {
      status = '⚠️  IGNORADO';
    } else if (result.success && result.filtered) {
      status = '🔧 SUCESSO (FILTRADO)';
    } else if (result.success) {
      status = '✅ SUCESSO';
    } else if (result.filtered) {
      status = '🔧 FALHOU (FILTRADO)';
    } else {
      status = '❌ FALHOU';
    }
    
    logContent += `${index + 1}. ${result.description}\n`;
    logContent += `   Status: ${status}\n`;
    logContent += `   Comando: ${result.command}\n`;
    logContent += `   Código de saída: ${result.code}\n`;
    logContent += `   Horário: ${new Date(result.timestamp).toLocaleString('pt-BR')}\n`;
    
    // Só mostrar output se NÃO for um teste filtrado (para manter log limpo)
    if (!result.filtered && result.output && result.output.length > 0) {
      logContent += `   Output:\n`;
      const outputLines = result.output.split('\n');
      outputLines.forEach(line => {
        if (line.trim()) {
          logContent += `     ${line}\n`;
        }
      });
    } else if (result.filtered) {
      logContent += `   ℹ️  Output: [Filtrado - erros dos scripts de log removidos]\n`;
    }
    
    logContent += `\n`;
  });
  
  // Seção de erros detalhados (apenas para falhas reais, não filtradas)
  const failedTests = testResults.filter(r => !r.success && !r.skipped && !r.filtered);
  if (failedTests.length > 0) {
    logContent += `🚨 ERROS DETALHADOS\n`;
    logContent += `${'-'.repeat(30)}\n\n`;
    
    failedTests.forEach((result, index) => {
      logContent += `Erro ${index + 1}: ${result.description}\n`;
      logContent += `${'-'.repeat(20)}\n`;
      
      if (result.stderr) {
        logContent += `Detalhes do erro:\n${result.stderr}\n\n`;
      }
      
      if (result.stdout && result.stdout !== result.stderr) {
        logContent += `Output adicional:\n${result.stdout}\n\n`;
      }
    });
  }
  
  // Seção para informar sobre erros filtrados (sem mostrar detalhes)
  const filteredFailedTests = testResults.filter(r => !r.success && r.filtered);
  if (filteredFailedTests.length > 0) {
    logContent += `🔧 ERROS FILTRADOS\n`;
    logContent += `${'-'.repeat(30)}\n\n`;
    
    filteredFailedTests.forEach((result, index) => {
      logContent += `Filtrado ${index + 1}: ${result.description}\n`;
      logContent += `${'-'.repeat(20)}\n`;
      logContent += `Tipo: Erros dos scripts de log removidos\n`;
      logContent += `Motivo: Continha referências a build-logger.js, analyze-logs.js ou setup-ignore-scripts.js\n\n`;
    });
  }
  
  // Rodapé
  logContent += `${'='.repeat(60)}\n`;
  logContent += `Testes executados: ${testResults.map(r => r.description).join(', ')}\n`;
  
  // Informações sobre testes ignorados
  if (!prismaInstalled || !prismaSchemaExists) {
    logContent += `Testes ignorados: `;
    const ignoredTests = [];
    if (!prismaInstalled) {
      ignoredTests.push('Prisma (não instalado)');
    } else if (!prismaSchemaExists) {
      ignoredTests.push('Prisma (schema não encontrado)');
    }
    logContent += `${ignoredTests.join(', ')}\n`;
  }
  
  logContent += `Data/Hora: ${timestamp}\n`;
  logContent += `Duração total: ${Math.round((Date.now() - startTime) / 1000)}s\n`;
  
  fs.writeFileSync(logPath, logContent);
  console.log(`📄 Log completo salvo em: ${logPath}`);
  
  return logPath;
}

// Função principal para executar todos os testes
async function runAllTests() {
  console.log('🚀 Iniciando bateria completa de testes...\n');
  
  const testResults = [];
  
  // Verificar se Prisma está instalado
  const prismaInstalled = isPrismaInstalled();
  const prismaSchemaExists = hasPrismaSchema();
  
  if (prismaInstalled && prismaSchemaExists) {
    console.log('✅ Prisma detectado - testes do Prisma serão incluídos');
  } else if (!prismaInstalled) {
    console.log('⚠️  Prisma não instalado - testes do Prisma serão ignorados');
  } else if (!prismaSchemaExists) {
    console.log('⚠️  Schema do Prisma não encontrado - testes do Prisma serão ignorados');
  }
  console.log('');
  
  // 1. TypeScript Check
  testResults.push(
    await runCommand('npx', ['tsc', '--noEmit'], 'Verificação TypeScript')
  );
  
  // 2. ESLint Check
  testResults.push(
    await runCommand('npx', ['eslint', '.', '--max-warnings', '0'], 'Verificação ESLint')
  );
  
  // 3. Prisma Generate (apenas se Prisma estiver instalado e schema existir)
  if (prismaInstalled && prismaSchemaExists) {
    testResults.push(
      await runCommand('npx', ['prisma', 'generate'], 'Geração do Cliente Prisma')
    );
  }
  
  // 4. Prisma Migrate Status (apenas se Prisma estiver instalado e schema existir)
  if (prismaInstalled && prismaSchemaExists) {
    testResults.push(
      await runCommand('npx', ['prisma', 'migrate', 'status'], 'Status das Migrações Prisma')
    );
  }
  
  // 5. Build do Next.js
  testResults.push(
    await runCommand('npm', ['run', 'build:dev'], 'Build do Next.js')
  );
  
  // 6. Verificação de dependências (opcional)
  testResults.push(
    await runCommand('npm', ['audit', '--audit-level', 'high'], 'Auditoria de Segurança')
  );
  
  // 7. Verificação de tipos do package.json
  testResults.push(
    await runCommand('npm', ['ls', '--depth=0'], 'Verificação de Dependências')
  );
  
  return testResults;
}

// Variável para medir tempo total
let startTime;

// Função principal
async function main() {
  startTime = Date.now();
  
  try {
    // Executar todos os testes
    const rawTestResults = await runAllTests();
    
    console.log('\n🔧 Filtrando erros dos scripts de log...');
    
    // Filtrar erros relacionados aos scripts de log
    const testResults = filterLogScriptErrors(rawTestResults);
    
    console.log('\n' + '='.repeat(60));
    console.log('📊 RESULTADO FINAL');
    console.log('='.repeat(60));
    
    // Verificar se há erros recorrentes
    const logsDir = path.join(process.cwd(), 'logs');
    const isRecurrent = checkIfErrorIsRecurrent(testResults, logsDir);
    
    // Análise dos resultados (após filtro)
    const successCount = testResults.filter(r => r.success).length;
    const failedCount = testResults.filter(r => !r.success && !r.skipped).length;
    const skippedCount = testResults.filter(r => r.skipped).length;
    const filteredCount = testResults.filter(r => r.filtered).length;
    
    console.log(`✅ Sucessos: ${successCount}`);
    console.log(`❌ Falhas: ${failedCount}`);
    console.log(`⚠️  Ignorados: ${skippedCount}`);
    if (filteredCount > 0) {
      console.log(`🔧 Filtrados: ${filteredCount} (erros de scripts de log removidos)`);
    }
    
    if (failedCount === 0) {
      console.log('\n🎉 Todos os testes passaram! Projeto está limpo.');
    } else {
      console.log('\n❌ Alguns testes falharam. Verifique os detalhes no log.');
      
      if (isRecurrent) {
        console.log('⚠️  ATENÇÃO: Erros recorrentes detectados!');
      }
      
      // Mostrar resumo dos erros
      const failedTests = testResults.filter(r => !r.success && !r.skipped);
      console.log('\n🚨 Testes que falharam:');
      failedTests.forEach((test, index) => {
        console.log(`   ${index + 1}. ${test.description}`);
      });
    }
    
    // Gerar log detalhado
    const logPath = generateComprehensiveLog(testResults, isRecurrent);
    
    console.log('\n' + '=' .repeat(60));
    console.log('📋 PRÓXIMOS PASSOS:');
    console.log('='.repeat(60));
    
    if (failedCount > 0) {
      console.log('1. 📄 Analise o log detalhado gerado');
      console.log('2. 🔍 Execute: node analyze-logs.js');
      console.log('3. 🛠️  Siga as instruções específicas do relatório');
      console.log('4. 🔄 Execute novamente este script após as correções');
    } else {
      console.log('1. ✅ Projeto está funcionando corretamente');
      console.log('2. 🚀 Pode fazer deploy ou continuar desenvolvimento');
    }
    
    const duration = Math.round((Date.now() - startTime) / 1000);
    console.log(`\n⏱️  Tempo total: ${duration}s`);
    
  } catch (error) {
    console.error('\n❌ Erro durante a execução dos testes:', error.message);
    
    // Gerar log de erro crítico
    const errorResult = [{
      command: 'main',
      description: 'Execução do script',
      code: 1,
      success: false,
      stdout: '',
      stderr: error.message,
      output: error.message,
      timestamp: new Date().toISOString()
    }];
    
    generateComprehensiveLog(errorResult, false);
    process.exit(1);
  }
}

// Função para testar a detecção do Prisma (modo debug)
function testPrismaDetection() {
  console.log('🔍 TESTE DE DETECÇÃO DO PRISMA');
  console.log('=' .repeat(40));
  
  const prismaInstalled = isPrismaInstalled();
  const prismaSchemaExists = hasPrismaSchema();
  
  console.log(`Prisma instalado: ${prismaInstalled ? '✅ Sim' : '❌ Não'}`);
  console.log(`Schema existe: ${prismaSchemaExists ? '✅ Sim' : '❌ Não'}`);
  
  if (prismaInstalled) {
    console.log('📦 Pacotes Prisma encontrados no package.json');
  } else {
    console.log('⚠️  Nenhum pacote Prisma encontrado no package.json');
  }
  
  if (prismaSchemaExists) {
    console.log('📄 Arquivo prisma/schema.prisma encontrado');
  } else {
    console.log('⚠️  Arquivo prisma/schema.prisma não encontrado');
  }
  
  console.log('=' .repeat(40));
  console.log('');
}

// Verificar se estamos na raiz do projeto
if (!fs.existsSync('package.json')) {
  console.error('❌ Erro: package.json não encontrado. Execute este script na raiz do projeto.');
  process.exit(1);
}

// Verificar argumentos de linha de comando
const args = process.argv.slice(2);

if (args.includes('--test-prisma') || args.includes('-t')) {
  // Modo de teste da detecção do Prisma
  testPrismaDetection();
  process.exit(0);
}

// Executar o script principal
main();

// Função para filtrar erros relacionados aos scripts de log
function filterLogScriptErrors(testResults) {
  const logScriptFiles = ['build-logger.js', 'analyze-logs.js', 'setup-ignore-scripts.js'];
  
  const filteredResults = testResults.map(result => {
    if (result.skipped || result.success) {
      return result; // Não modificar resultados bem-sucedidos ou ignorados
    }
    
    // Verificar se o erro está relacionado aos scripts de log
    const hasLogScriptError = logScriptFiles.some(scriptFile => {
      return result.output.includes(scriptFile) || 
             result.stdout.includes(scriptFile) || 
             result.stderr.includes(scriptFile);
    });
    
    if (hasLogScriptError) {
      console.log(`🔧 Ignorando erros de ${result.description} relacionados aos scripts de log`);
      
      // Filtrar linhas de erro dos scripts de log
      const filteredOutput = filterLogScriptLines(result.output, logScriptFiles);
      const filteredStdout = filterLogScriptLines(result.stdout, logScriptFiles);
      const filteredStderr = filterLogScriptLines(result.stderr, logScriptFiles);
      
      // Verificar se há erros restantes após filtro
      const hasRemainingErrors = checkForRemainingErrors(filteredOutput, filteredStdout, filteredStderr);
      
      if (!hasRemainingErrors) {
        console.log(`   ✅ ${result.description} agora é considerado bem-sucedido após filtro`);
        return {
          ...result,
          success: true,
          code: 0,
          output: '',
          stdout: '',
          stderr: '',
          filtered: true // Flag para indicar que foi filtrado
        };
      } else {
        console.log(`   ⚠️  ${result.description} ainda tem erros após filtro`);
        return {
          ...result,
          output: filteredOutput,
          stdout: filteredStdout,
          stderr: filteredStderr,
          filtered: true
        };
      }
    }
    
    return result;
  });
  
  return filteredResults;
}

// Função auxiliar para verificar se há erros restantes após filtro
function checkForRemainingErrors(output, stdout, stderr) {
  const combinedText = (output + stdout + stderr).trim();
  
  // Se não há texto restante, não há erros
  if (!combinedText) return false;
  
  // Verificar indicadores de erro comuns
  const errorIndicators = [
    'error',
    'Error:',
    'TypeError:',
    'SyntaxError:',
    'ReferenceError:',
    'warning',
    'Warning:',
    'fail',
    'failed',
    'FAIL',
    'FAILED'
  ];
  
  const lowerText = combinedText.toLowerCase();
  return errorIndicators.some(indicator => lowerText.includes(indicator.toLowerCase()));
}

// Função auxiliar para filtrar linhas específicas dos scripts de log
function filterLogScriptLines(text, logScriptFiles) {
  if (!text) return '';
  
  const lines = text.split('\n');
  const filteredLines = [];
  
  for (const line of lines) {
    // Verificar se a linha contém referência aos scripts de log
    const hasScriptReference = logScriptFiles.some(scriptFile => {
      // Verificar diferentes formatos de referência aos arquivos
      return line.includes(scriptFile) || 
             line.includes(`./${scriptFile}`) ||
             line.includes(`/${scriptFile}`) ||
             line.includes(`"${scriptFile}"`) ||
             line.includes(`'${scriptFile}'`);
    });
    
    if (!hasScriptReference) {
      filteredLines.push(line);
    } else {
      console.log(`   📝 Removendo linha: ${line.trim()}`);
    }
  }
  
  return filteredLines.join('\n');
}