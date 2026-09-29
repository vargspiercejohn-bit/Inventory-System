# Inventory System

A local full-stack inventory web app using Next.js and PostgreSQL. The working modules are Dashboard, Items, Stock Card, Categories, and Reports.

## Requirements

- Node.js 22 or newer
- PostgreSQL running locally

This project is configured for the connected pgAdmin server named `Local PostgreSQL`, running PostgreSQL 17 on `localhost:5433`.

## First-time setup

Install dependencies:

```powershell
npm.cmd install
```

Connect the app to the existing local `inventory_db` PostgreSQL database and create its private `.env.local` configuration:

```powershell
npm.cmd run db:setup
```

The setup command asks for the `postgres` user's password securely. The password is saved only in the ignored `.env.local` file on this device.

## Run locally

```powershell
npm.cmd run dev
```

Open [http://localhost:3001](http://localhost:3001). On the first inventory request, the app creates its PostgreSQL tables and starter records automatically.

Devices on the same Wi-Fi can use [http://192.168.110.148:3001](http://192.168.110.148:3001) while this computer and the server remain running.

## Other commands

- `npm.cmd run build`: verify the production build
- `npm.cmd run start`: run the completed production build
- `npm.cmd run db:generate`: generate PostgreSQL migrations from `db/schema.ts`

## Local data

Inventory records are stored in the local PostgreSQL database named `inventory_db`. They are separate from the currently published website's records.
