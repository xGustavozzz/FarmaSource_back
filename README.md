# 🛡️ FarmaSecure - Backend API

[![Node.js Version](https://img.shields.io/badge/node-%3E%3D%2018.0.0-blue.svg?style=for-the-badge&logo=node.js)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Express](https://img.shields.io/badge/Express.js-000000?style=for-the-badge&logo=express&logoColor=white)](https://expressjs.com/)
[![Oracle Database](https://img.shields.io/badge/Oracle_Database-F80000?style=for-the-badge&logo=oracle&logoColor=white)](https://www.oracle.com/database/)

FarmaSecure es una API REST segura, transaccional y robusta diseñada para la gestión integral de farmacias. Sirve como el motor del sistema, comunicándose directamente con una base de datos local **Oracle Database** (`farmaciapdb`) en modo Thin.

---

## 🚀 Características Clave

*   **Autenticación Criptográfica Estricta**: Control de accesos verificado mediante contraseñas cifradas con `bcryptjs` contra la tabla `USUARIOS_APP` en Oracle DB.
*   **Seguridad Basada en Roles (RBAC)**: Middlewares dedicados que restringen los recursos según el nivel de autorización del colaborador.
*   **Integración de Vistas de Lectura (GET)**: Consulta simplificada y de alto rendimiento utilizando vistas de base de datos (`V_PRODUCTOS_CATALOGO`, `V_CLIENTES_COMPLETO`, `V_AUDIT_RESUMEN`, etc.).
*   **Transacciones Atómicas con PL/SQL (POST)**: Escritura y lógica transaccional delegada a procedimientos almacenados del paquete `pkg_procesos_app` (registro de clientes y empleados).
*   **Bitácora de Auditoría Inmutable**: Registro automático de todas las operaciones sensibles (`INSERT`, `UPDATE`, `DELETE`) en la tabla `AUDIT_LOGS`, previniendo inyecciones de datos no autorizadas y validando la integridad a nivel de base de datos.

---

## 🛠️ Stack Tecnológico

*   **Core**: Node.js & Express (TypeScript)
*   **Base de Datos**: Oracle Database (Thin Mode via `node-oracledb` v6.5.0)
*   **Seguridad**: `bcryptjs` (Hashing de contraseñas)
*   **Desarrollo**: `ts-node-dev` (Transpilación en tiempo real y autorecarga)

---

## 📁 Estructura del Código

```bash
FarmaSource_back/
├── src/
│   ├── config/          # Inicialización y Pool de Conexiones a Oracle
│   │   └── db.ts
│   ├── middleware/      # Middlewares de seguridad (CORS, RBAC, Auth)
│   │   └── security.ts
│   ├── routes/          # Endpoints estructurados por recursos
│   │   ├── audit.ts
│   │   ├── auth.ts
│   │   ├── clients.ts
│   │   ├── dashboard.ts
│   │   ├── employees.ts
│   │   ├── products.ts
│   │   └── sales.ts
│   └── server.ts        # Punto de entrada de la aplicación
├── .env                 # Variables de entorno confidenciales
├── package.json
└── tsconfig.json
```

---

## 🔐 Matriz de Control de Accesos (RBAC)

| Módulo / Ruta | Endpoint | Administrador | Regente Farmacéutico | Vendedor | Auditor |
| :--- | :--- | :---: | :---: | :---: | :---: |
| **Autenticación** | `POST /auth/login` | ✅ | ✅ | ✅ | ✅ |
| **Mi Perfil** | `POST /auth/change-password` | ✅ | ✅ | ✅ | ✅ |
| **Dashboard** | `GET /dashboard` | ✅ | ❌ | ❌ | ✅ |
| **Catálogo** | `GET /products` | ✅ | ✅ | ✅ | ❌ |
| **Medicamentos** | `POST`/`PUT`/`DEL` `/products` | ✅ | ✅ | ❌ | ❌ |
| **Clientes** | `GET`/`POST`/`PUT` `/clients` | ✅ | ❌ | ✅ | ❌ |
| **POS Ventas** | `GET`/`POST` `/sales` | ✅ | ❌ | ✅ | ❌ |
| **Nómina** | `GET`/`POST`/`PUT` `/employees` | ✅ | ❌ | ❌ | ❌ |
| **Bitácoras** | `GET` `/audit` | ✅ | ❌ | ❌ | ✅ |


---

## 🏁 Instalación y Configuración

### 1. Requisitos Previos
*   **Node.js** v18 o superior.
*   **Oracle Database** local en ejecución con el servicio `farmaciapdb` y el usuario `admin_farmacia` configurado.

### 2. Configurar Variables de Entorno
Crea un archivo `.env` en la raíz del proyecto backend:

```env
PORT=
DB_USER=
DB_PASSWORD=
DB_CONNECT_STRING=
```

### 3. Instalar Dependencias
```bash
npm install
```

### 4. Lanzar el Servidor en Desarrollo
```bash
npm run dev
```
El backend estará disponible en: `http://localhost:3001`.

### 5. Compilar para Producción
```bash
npm run build
```
Genera la carpeta `dist/` con el código transpilado a JavaScript limpio.

---

## 🤝 Contribuciones y Desarrollo

Las consultas de lectura y modificaciones transaccionales deben seguir las directrices de inmutabilidad del sistema de auditoría. Asegúrate de verificar las restricciones de la base de datos antes de realizar cambios de esquema.
