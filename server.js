const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const port = Number(process.env.PORT) || 3000;
const storePath = path.join(__dirname, 'store.json');

function readStore() {
  try {
    return JSON.parse(fs.readFileSync(storePath, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const store = { items: [], reservations: [] };
    writeStore(store);
    return store;
  }
}

function writeStore(store) {
  fs.writeFileSync(storePath, JSON.stringify(store, null, 2));
}

function sendJson(response, status, data) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(data));
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        reject(new Error('Żądanie jest zbyt duże.'));
        request.destroy();
      }
    });
    request.on('end', () => {
      try {
        resolve(JSON.parse(body || '{}'));
      } catch {
        reject(new Error('Nieprawidłowe dane.'));
      }
    });
    request.on('error', reject);
  });
}

function cleanText(value, maxLength) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

async function handleApi(request, response, url) {
  const store = readStore();

  if (request.method === 'GET' && url.pathname === '/api/items') {
    const reservedIds = new Set(store.reservations.map((reservation) => reservation.itemId));
    return sendJson(response, 200, store.items.map((item) => ({
      ...item,
      reserved: reservedIds.has(item.id),
    })));
  }

  if (request.method === 'GET' && url.pathname === '/api/reservations') {
    const itemsById = new Map(store.items.map((item) => [item.id, item.name]));
    return sendJson(response, 200, store.reservations.map((reservation) => ({
      ...reservation,
      itemName: itemsById.get(reservation.itemId) || 'Removed item',
    })));
  }

  if (request.method === 'POST' && url.pathname === '/api/items') {
    const body = await readBody(request);
    const latestStore = readStore();
    const item = {
      id: randomUUID(),
      name: cleanText(body.name, 80),
      category: cleanText(body.category, 40) || 'Inne',
      condition: cleanText(body.condition, 40) || 'Używany',
      description: cleanText(body.description, 500),
      imageUrl: cleanText(body.imageUrl, 500),
      createdAt: new Date().toISOString(),
    };
    if (!item.name) return sendJson(response, 400, { error: 'Wpisz nazwę przedmiotu.' });
    if (item.imageUrl && !/^https?:\/\//i.test(item.imageUrl)) {
      return sendJson(response, 400, { error: 'Link do zdjęcia musi zaczynać się od http:// lub https://.' });
    }
    latestStore.items.unshift(item);
    writeStore(latestStore);
    return sendJson(response, 201, item);
  }

  if (request.method === 'POST' && url.pathname === '/api/reservations') {
    const body = await readBody(request);
    const latestStore = readStore();
    const item = latestStore.items.find((entry) => entry.id === body.itemId);
    if (!item) return sendJson(response, 404, { error: 'Ten przedmiot nie jest już dostępny.' });
    if (latestStore.reservations.some((reservation) => reservation.itemId === item.id)) {
      return sendJson(response, 409, { error: 'Ten przedmiot został już zarezerwowany.' });
    }
    const name = cleanText(body.name, 80);
    const contact = cleanText(body.contact, 120);
    if (!name || !contact) return sendJson(response, 400, { error: 'Podaj imię i nazwisko oraz dane kontaktowe.' });
    const reservation = {
      id: randomUUID(),
      itemId: item.id,
      name,
      contact,
      createdAt: new Date().toISOString(),
    };
    latestStore.reservations.push(reservation);
    writeStore(latestStore);
    return sendJson(response, 201, reservation);
  }

  const reservationMatch = url.pathname.match(/^\/api\/reservations\/([^/]+)$/);
  if (request.method === 'DELETE' && reservationMatch) {
    const index = store.reservations.findIndex((reservation) => reservation.id === reservationMatch[1]);
    if (index < 0) return sendJson(response, 404, { error: 'Nie znaleziono rezerwacji.' });
    store.reservations.splice(index, 1);
    writeStore(store);
    return sendJson(response, 200, { ok: true });
  }

  const itemMatch = url.pathname.match(/^\/api\/items\/([^/]+)$/);
  if (request.method === 'DELETE' && itemMatch) {
    if (store.reservations.some((reservation) => reservation.itemId === itemMatch[1])) {
      return sendJson(response, 409, { error: 'Clear its reservation before removing this item.' });
    }
    const index = store.items.findIndex((item) => item.id === itemMatch[1]);
    if (index < 0) return sendJson(response, 404, { error: 'Item not found.' });
    store.items.splice(index, 1);
    writeStore(store);
    return sendJson(response, 200, { ok: true });
  }

  return sendJson(response, 404, { error: 'Nie znaleziono.' });
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
  try {
    if (url.pathname.startsWith('/api/')) {
      return await handleApi(request, response, url);
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405);
      return response.end('Niedozwolona metoda.');
    }
    const filePath = url.pathname === '/' ? path.join(__dirname, 'index.html') : path.join(__dirname, url.pathname);
    if (filePath !== path.join(__dirname, 'index.html')) {
      response.writeHead(404);
      return response.end('Nie znaleziono.');
    }
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    if (request.method === 'HEAD') return response.end();
    return response.end(fs.readFileSync(filePath));
  } catch (error) {
    const status = error.message === 'Żądanie jest zbyt duże.' ? 413 : 400;
    if (!response.headersSent) return sendJson(response, status, { error: error.message || 'Coś poszło nie tak.' });
    response.destroy();
  }
});

server.listen(port, '0.0.0.0', () => {
  console.log(`Wyprzedaż działa pod adresem http://localhost:${port}`);
});