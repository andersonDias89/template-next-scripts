// Este script atualiza o package.json conforme solicitado.
// Uso: node update-scripts.js

const fs = require('fs');
const path = require('path');

const packageJsonPath = path.join(__dirname, 'package.json');

const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));

// Atualiza o script de build
packageJson.scripts.build = 'prisma generate && npx prisma migrate deploy && next build';
// Adiciona o build:dev logo abaixo do build
const scripts = {};
for (const [key, value] of Object.entries(packageJson.scripts)) {
  scripts[key] = value;
  if (key === 'build') {
    scripts['build:dev'] = 'prisma generate && next build';
  }
}
packageJson.scripts = scripts;

fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2) + '\n');

console.log('Scripts atualizados com sucesso!');
