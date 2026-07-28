const express = require('express');
const path = require('path');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const mongoose = require('mongoose'); // Adicionado MongoDB

const app = express();
const PORT = process.env.PORT || 1002;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.get('/manifest.json', (req, res) => res.sendFile(path.join(__dirname, 'public', 'manifest.json')));
app.use(session({
    secret: 'fvb_s3cr3t_2024_secure_xYz',
    resave: true, saveUninitialized: true, rolling: true,
    cookie: { maxAge: 8 * 60 * 60 * 1000, httpOnly: false, sameSite: 'lax', secure: false }
}));

// ===== CONEXÃO MONGODB =====
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/fvb';
mongoose.connect(MONGODB_URI).then(() => console.log('MongoDB Conectado!')).catch(err => console.error('Erro MongoDB:', err));

const DBSchema = new mongoose.Schema({
    _id: { type: String, default: 'main_db' },
    company: { type: Object, default: { nome: 'FVB', logo_url: '/logo.png', dia_fechamento: 25, dia_pagamento: 5 } },
    admin: { type: Object, default: { login: 'FT', senha_hash: bcrypt.hashSync('Naty161023@@@', 12) } },
    employees: { type: Array, default: [] },
    nextId: { type: Number, default: 1 }
});
const DBModel = mongoose.model('DB', DBSchema);

async function loadDB() {
    let doc = await DBModel.findById('main_db');
    if (!doc) { doc = new DBModel({ _id: 'main_db' }); await doc.save(); }
    let db = doc.toObject();
    let ch = false;
    if (db.company.dia_fechamento === undefined) { db.company.dia_fechamento = 25; ch = true; }
    if (db.company.dia_pagamento === undefined) { db.company.dia_pagamento = 5; ch = true; }
    db.employees.forEach(e => {
        if (e.taxa_hora_extra !== undefined && e.taxa_he_semana === undefined) { e.taxa_he_semana = 50; e.taxa_he_fds_feriado = 100; delete e.taxa_hora_extra; ch = true; }
        if (e.taxa_he_semana === undefined) { e.taxa_he_semana = 50; ch = true; }
        if (e.taxa_he_fds_feriado === undefined) { e.taxa_he_fds_feriado = 100; ch = true; }
        if (e.recebe_vt === undefined) { e.recebe_vt = true; ch = true; }
        if (!e.overtime) e.overtime = {};
        if (!e.absences) e.absences = {};
    });
    if (ch) await saveDB(db);
    return db;
}
async function saveDB(db) { await DBModel.findByIdAndUpdate('main_db', db, { upsert: true }); }
function findE(db, mat) { return db.employees.find(e => e.matricula === mat); }
function getMA() { const n = new Date(); return n.getFullYear() + '-' + String(n.getMonth() + 1).padStart(2, '0'); }

// ===== FERIADOS =====
function getEaster(y) { const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451), mo = Math.floor((h + l - 7 * m + 114) / 31), dy = ((h + l - 7 * m + 114) % 31) + 1; return new Date(y, mo - 1, dy); }
function getFeriados(y) { const p = getEaster(y); const fmt = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); const ad = (d, n) => { const r = new Date(d); r.setDate(r.getDate() + n); return r; }; return new Set([y + '-01-01', y + '-04-21', y + '-05-01', y + '-09-07', y + '-10-12', y + '-11-02', y + '-11-15', y + '-12-25', fmt(ad(p, -47)), fmt(ad(p, -46)), fmt(ad(p, -2)), fmt(ad(p, 60))]); }
function isFdsOuFeriado(ds) { const [y, m, d] = ds.split('-').map(Number); const dt = new Date(y, m - 1, d); if (dt.getDay() === 0 || dt.getDay() === 6) return true; return getFeriados(y).has(ds); }

function getHEByMonth(emp, mes) { if (!emp.overtime) return []; return Object.entries(emp.overtime).filter(([d]) => mes === 'all' || d.startsWith(mes)).map(([data, horas]) => ({ data, horas, tipo: isFdsOuFeriado(data) ? 'fds_feriado' : 'semana' })).sort((a, b) => b.data.localeCompare(a.data)); }
function getHESum(emp, mes) { const e = getHEByMonth(emp, mes); let total = 0, semana = 0, fds = 0; e.forEach(r => { total += r.horas; if (r.tipo === 'fds_feriado') fds += r.horas; else semana += r.horas; }); return { total, semana, fds }; }
function getAbsByMonth(emp, mes) { if (!emp.absences) return []; return Object.entries(emp.absences).filter(([d]) => mes === 'all' || d.startsWith(mes)).map(([data, v]) => ({ data, tipo: v.tipo, horas: v.horas || 0 })).sort((a, b) => b.data.localeCompare(a.data)); }
function getAbsSum(emp, mes) { const e = getAbsByMonth(emp, mes); let faltas = 0, atrasos = 0, horasAtraso = 0; e.forEach(r => { if (r.tipo === 'falta') faltas++; else { atrasos++; horasAtraso += r.horas || 0; } }); return { faltas, atrasos, horasAtraso }; }
function getFolgasMes(dataEntrada, year, month) { if (!dataEntrada) return []; const folgas = [], dim = new Date(year, month + 1, 0).getDate(); for (let d = 1; d <= dim; d++) { const ds = year + '-' + String(month + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0'); const [ey, em, ed] = dataEntrada.split('-').map(Number), entry = new Date(ey, em - 1, ed), dt = new Date(year, month, d); const diff = Math.floor((dt.getTime() - entry.getTime()) / 864e5); if (diff >= 0 && diff % 8 >= 6) { const dow = dt.getDay(); folgas.push({ data: ds, dataBR: String(d).padStart(2, '0') + '/' + String(month + 1).padStart(2, '0') + '/' + year, diaSemana: ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'][dow] }); } } return folgas; }

function reqL(req, res, next) { if (!req.session.user) return res.status(401).json({ erro: 'Nao autenticado' }); next(); }
function reqA(req, res, next) { if (!req.session.admin) return res.status(403).json({ erro: 'Acesso negado' }); next(); }

// ===== AUTH =====
app.post('/api/auth/register', async (req, res) => { try { const { nome, matricula } = req.body; if (!nome || nome.trim().length < 3) return res.status(400).json({ erro: 'Nome obrigatorio (min. 3)' }); if (!matricula || !/^\d+$/.test(matricula.trim())) return res.status(400).json({ erro: 'Matricula: apenas numeros' }); const mat = matricula.trim(), db = await loadDB(); if (findE(db, mat)) return res.status(409).json({ erro: 'Matricula ja cadastrada' }); const emp = { id: db.nextId++, matricula: mat, nome: nome.trim(), data_entrada: '', salario_base: 0, taxa_he_semana: 50, taxa_he_fds_feriado: 100, recebe_vt: true, overtime: {}, absences: {}, criado_em: new Date().toISOString() }; db.employees.push(emp); await saveDB(db); req.session.user = { id: emp.id, matricula: emp.matricula, nome: emp.nome }; return res.json({ ok: true, user: req.session.user }); } catch (e) { return res.status(500).json({ erro: 'Erro ao cadastrar' }); } });
app.post('/api/auth/login', async (req, res) => { try { const { matricula } = req.body; if (!matricula || !matricula.trim()) return res.status(400).json({ erro: 'Matricula obrigatoria' }); const db = await loadDB(), emp = findE(db, matricula.trim()); if (!emp) return res.status(404).json({ erro: 'Matricula nao encontrada' }); req.session.user = { id: emp.id, matricula: emp.matricula, nome: emp.nome }; return res.json({ ok: true, user: req.session.user }); } catch (e) { return res.status(500).json({ erro: 'Erro' }); } });
app.post('/api/auth/admin-login', async (req, res) => { try { const { login, senha } = req.body; if (!login || !senha) return res.status(400).json({ erro: 'Login e senha obrigatorios' }); const db = await loadDB(); if (login.trim() !== db.admin.login || !bcrypt.compareSync(senha, db.admin.senha_hash)) return res.status(401).json({ erro: 'Credenciais invalidas' }); req.session.admin = { login: db.admin.login }; return res.json({ ok: true }); } catch (e) { return res.status(500).json({ erro: 'Erro' }); } });
app.get('/api/auth/me', (req, res) => { if (req.session.user) return res.json({ type: 'employee', user: req.session.user }); if (req.session.admin) return res.json({ type: 'admin', user: req.session.admin }); return res.status(401).json({ erro: 'Nao autenticado' }); });
app.post('/api/auth/logout', (req, res) => { req.session.destroy(() => res.json({ ok: true })); });

// ===== EMPLOYEE =====
app.get('/api/employee/profile', reqL, async (req, res) => { const db = await loadDB(), emp = findE(db, req.session.user.matricula); if (!emp) return res.status(404).json({ erro: 'Nao encontrado' }); return res.json({ ...emp, total_he_mes: getHESum(emp, getMA()).total, total_faltas_mes: getAbsSum(emp, getMA()).faltas }); });
app.put('/api/employee/profile', reqL, async (req, res) => { try { const { nome, data_entrada, salario_base, taxa_he_semana, taxa_he_fds_feriado, recebe_vt } = req.body; const db = await loadDB(), emp = findE(db, req.session.user.matricula); if (!emp) return res.status(404).json({ erro: 'Nao encontrado' }); if (nome) emp.nome = nome; emp.data_entrada = data_entrada || ''; emp.salario_base = parseFloat(salario_base) || 0; emp.taxa_he_semana = parseFloat(taxa_he_semana) || 50; emp.taxa_he_fds_feriado = parseFloat(taxa_he_fds_feriado) || 100; emp.recebe_vt = recebe_vt === true || recebe_vt === 'true' || recebe_vt === 1; await saveDB(db); if (nome) req.session.user.nome = nome; return res.json({ ok: true }); } catch (e) { return res.status(500).json({ erro: 'Erro' }); } });
app.get('/api/employee/overtime', reqL, async (req, res) => { const db = await loadDB(), emp = findE(db, req.session.user.matricula); if (!emp) return res.status(404).json({ erro: 'Nao encontrado' }); return res.json(getHEByMonth(emp, req.query.mes || getMA())); });
app.post('/api/employee/overtime', reqL, async (req, res) => { try { const { data, horas } = req.body; if (!data) return res.status(400).json({ erro: 'Data obrigatoria' }); const h = parseFloat(horas); if (!h || h < 0.5 || h > 12) return res.status(400).json({ erro: 'Horas entre 0.5 e 12' }); const db = await loadDB(), emp = findE(db, req.session.user.matricula); if (!emp) return res.status(404).json({ erro: 'Nao encontrado' }); if (!emp.overtime) emp.overtime = {}; emp.overtime[data] = (emp.overtime[data] || 0) + h; await saveDB(db); return res.json({ ok: true }); } catch (e) { return res.status(500).json({ erro: 'Erro' }); } });
app.delete('/api/employee/overtime/:data', reqL, async (req, res) => { try { const db = await loadDB(), emp = findE(db, req.session.user.matricula); if (!emp) return res.status(404).json({ erro: 'Nao encontrado' }); if (emp.overtime && emp.overtime[req.params.data] !== undefined) { delete emp.overtime[req.params.data]; await saveDB(db); } return res.json({ ok: true }); } catch (e) { return res.status(500).json({ erro: 'Erro' }); } });
app.get('/api/employee/absences', reqL, async (req, res) => { const db = await loadDB(), emp = findE(db, req.session.user.matricula); if (!emp) return res.status(404).json({ erro: 'Nao encontrado' }); return res.json(getAbsByMonth(emp, req.query.mes || getMA())); });
app.post('/api/employee/absences', reqL, async (req, res) => { try { const { data, tipo, horas } = req.body; if (!data || !tipo) return res.status(400).json({ erro: 'Data e tipo obrigatorios' }); if (tipo !== 'falta' && tipo !== 'atraso') return res.status(400).json({ erro: 'Tipo invalido: falta ou atraso' }); if (tipo === 'atraso') { const h = parseFloat(horas); if (!h || h < 0.5 || h > 12) return res.status(400).json({ erro: 'Horas de atraso entre 0.5 e 12' }); } const db = await loadDB(), emp = findE(db, req.session.user.matricula); if (!emp) return res.status(404).json({ erro: 'Nao encontrado' }); if (!emp.absences) emp.absences = {}; emp.absences[data] = { tipo, horas: tipo === 'atraso' ? parseFloat(horas) : 0 }; await saveDB(db); return res.json({ ok: true }); } catch (e) { return res.status(500).json({ erro: 'Erro' }); } });
app.delete('/api/employee/absences/:data', reqL, async (req, res) => { try { const db = await loadDB(), emp = findE(db, req.session.user.matricula); if (!emp) return res.status(404).json({ erro: 'Nao encontrado' }); if (emp.absences && emp.absences[req.params.data] !== undefined) { delete emp.absences[req.params.data]; await saveDB(db); } return res.json({ ok: true }); } catch (e) { return res.status(500).json({ erro: 'Erro' }); } });

app.get('/api/employee/salary', reqL, async (req, res) => {
    const db = await loadDB(), emp = findE(db, req.session.user.matricula);
    if (!emp) return res.status(404).json({ erro: 'Nao encontrado' });
    const mes = req.query.mes || getMA(), sums = getHESum(emp, mes), absS = getAbsSum(emp, mes);
    let baseCalc = emp.salario_base, isProporcional = false;
    if (emp.data_entrada && emp.data_entrada.startsWith(mes)) {
        isProporcional = true;
        const [y, m, dStart] = emp.data_entrada.split('-').map(Number);
        const daysInMonth = new Date(y, m, 0).getDate(); let totalWorkDays = 0, workedWorkDays = 0;
        for (let day = 1; day <= daysInMonth; day++) { const ds = `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`; if (!isFdsOuFeriado(ds)) { totalWorkDays++; if (day >= dStart) workedWorkDays++; } }
        if (totalWorkDays > 0 && workedWorkDays < totalWorkDays) baseCalc = (workedWorkDays / totalWorkDays) * emp.salario_base;
    }
    const vh = emp.salario_base / 220, tS = emp.taxa_he_semana || 50, tF = emp.taxa_he_fds_feriado || 100;
    const vheS = vh * (1 + tS / 100), vheF = vh * (1 + tF / 100);
    const valSem = sums.semana * vheS, valFds = sums.fds * vheF, valExt = valSem + valFds;
    const descontoVT = emp.recebe_vt ? baseCalc * 0.06 : 0;
    const valorDia = emp.salario_base / 30, descontoFaltas = absS.faltas * valorDia, descontoAtrasos = absS.horasAtraso > 0 ? (absS.horasAtraso / 8) * valorDia : 0;
    const totalDescontos = descontoVT + descontoFaltas + descontoAtrasos, salarioLiq = baseCalc + valExt - totalDescontos;
    return res.json({ salario_base: baseCalc, proporcional: isProporcional, valor_hora: vh, valor_dia: valorDia, taxa_semana: tS, taxa_fds_feriado: tF, vhe_semana: vheS, vhe_fds_feriado: vheF, horas_semana: sums.semana, horas_fds: sums.fds, horas_total: sums.total, valor_semana: valSem, valor_fds: valFds, valor_total: valExt, recebe_vt: emp.recebe_vt, desconto_vt: descontoVT, faltas: absS.faltas, desconto_faltas: descontoFaltas, atrasos: absS.atrasos, horas_atraso: absS.horasAtraso, desconto_atrasos: descontoAtrasos, total_descontos: totalDescontos, salario_liquido: salarioLiq, salario_total: salarioLiq, mes, folha_info: { fechamento: db.company.dia_fechamento, pagamento: db.company.dia_pagamento } });
});
app.get('/api/employee/folgas', reqL, async (req, res) => { const db = await loadDB(), emp = findE(db, req.session.user.matricula); if (!emp) return res.status(404).json({ erro: 'Nao encontrado' }); const y = parseInt(req.query.ano) || new Date().getFullYear(), m = parseInt(req.query.mes); if (isNaN(m) || m < 0 || m > 11) return res.status(400).json({ erro: 'Mes invalido' }); return res.json(getFolgasMes(emp.data_entrada, y, m)); });

// ===== ADMIN =====
app.get('/api/admin/employees', reqA, async (req, res) => { const db = await loadDB(), mes = getMA(); return res.json(db.employees.map(e => ({ ...e, he_mes: getHESum(e, mes).total, faltas_mes: getAbsSum(e, mes).faltas }))); });
app.get('/api/admin/employees/:matricula', reqA, async (req, res) => { const db = await loadDB(), emp = findE(db, req.params.matricula); if (!emp) return res.status(404).json({ erro: 'Nao encontrado' }); const mes = getMA(), sums = getHESum(emp, mes), absS = getAbsSum(emp, mes); return res.json({ ...emp, he_mes: sums.total, overtime_rows: getHEByMonth(emp, mes), he_semana: sums.semana, he_fds: sums.fds, faltas_mes: absS.faltas, absences_rows: getAbsByMonth(emp, mes) }); });
app.delete('/api/admin/employees/:matricula', reqA, async (req, res) => { try { const db = await loadDB(), idx = db.employees.findIndex(e => e.matricula === req.params.matricula); if (idx < 0) return res.status(404).json({ erro: 'Nao encontrado' }); db.employees.splice(idx, 1); await saveDB(db); return res.json({ ok: true }); } catch (e) { return res.status(500).json({ erro: 'Erro' }); } });
app.get('/api/admin/company', async (req, res) => { return res.json((await loadDB()).company); });
app.put('/api/admin/company', reqA, async (req, res) => { try { const { nome, logo_url, dia_fechamento, dia_pagamento } = req.body; if (!nome || !nome.trim()) return res.status(400).json({ erro: 'Nome obrigatorio' }); const db = await loadDB(); db.company.nome = nome.trim(); db.company.logo_url = logo_url || ''; db.company.dia_fechamento = parseInt(dia_fechamento) || 25; db.company.dia_pagamento = parseInt(dia_pagamento) || 5; await saveDB(db); return res.json({ ok: true }); } catch (e) { return res.status(500).json({ erro: 'Erro' }); } });

app.listen(PORT, '0.0.0.0', () => console.log(`FVB - Sistema rodando na porta ${PORT}`));
