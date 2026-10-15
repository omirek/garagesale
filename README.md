# Saturday Finds

A small neighborhood sale site. Visitors can browse listings and reserve an item for pickup; no payment or account is involved. Reservations and inventory are shared across visitors and saved in `store.json`.

## Run

Requires Node.js 18 or newer. Start the server with:

```sh
npm start
```

Open <http://localhost:3000>. Set `PORT` to use a different port.

Use **Manage sale** to add or remove listings, review reservations, and release an item back to the sale. The site intentionally has no authentication: anyone who can reach it can manage listings and view reservation contact details. Keep it on a trusted network and only collect contact information you need for pickup.
