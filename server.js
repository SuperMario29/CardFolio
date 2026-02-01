const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const bodyParser = require('body-parser');

const app = express();
app.use(cors());
app.use(bodyParser.json());
// IMPORTANT: Ensure your HTML file is inside a folder named 'public'
app.use(express.static('public'));

// --- DATABASE CONNECTION ---
const db = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'card_inventory',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

const promisePool = db.promise();

// --- HELPER: Generate 6-digit OTP ---
const generateOTP = () => Math.floor(100000 + Math.random() * 900000).toString();

// --- API ENDPOINTS ---

// 1. LOGIN STEP 1: Validate Credentials & Generate OTP
app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const [rows] = await promisePool.query('SELECT * FROM users WHERE email = ?', [email]);
        
        if (rows.length > 0 && rows[0].password === password) {
            // Credentials correct. Generate OTP
            const otp = generateOTP();
            const expiry = new Date(new Date().getTime() + 5 * 60000); // Valid for 5 minutes

            await promisePool.query(
                'UPDATE users SET otp_code = ?, otp_expiry = ? WHERE email = ?',
                [otp, expiry, email]
            );

            // SIMULATED EMAIL: In a real app, use Nodemailer here. 
            // For this demo, we return the code so you can test without a real email server.
            console.log(`[SIMULATED EMAIL] Your 2FA code is: ${otp}`);

            // Return status indicating 2FA is needed
            res.json({ 
                requires2FA: true, 
                email: email,
                simulatedCode: otp 
            });
        } else {
            res.status(401).json({ error: 'Invalid email or password' });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 2. LOGIN STEP 2: Verify OTP
app.post('/api/verify-otp', async (req, res) => {
    const { email, code } = req.body;
    try {
        const [rows] = await promisePool.query(
            'SELECT * FROM users WHERE email = ? AND otp_code = ? AND otp_expiry > NOW()', 
            [email, code]
        );

        if (rows.length > 0) {
            const user = rows[0];
            
            // Clear OTP after successful login
            await promisePool.query('UPDATE users SET otp_code = NULL, otp_expiry = NULL WHERE id = ?', [user.id]);
            
            res.json({ success: true, user: user });
        } else {
            res.status(400).json({ error: 'Invalid or expired code' });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- INVENTORY ---
app.get('/api/inventory', async (req, res) => {
    try {
        const [rows] = await promisePool.query('SELECT * FROM inventory ORDER BY sku ASC');
        res.json(rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/inventory', async (req, res) => {
    const item = req.body;
    try {
        if (item.id) {
            // UPDATE: Only update basic fields, not inbound fields
            // We also update description here
            await promisePool.query(
                `UPDATE inventory SET sku=?, category_id=?, name=?, description=?, price=?, units=?, units_per_box=?, boxes_per_case=?, last_mod=NOW() WHERE id=?`,
                [item.sku, item.catId, item.name, item.description, item.price, item.units, item.unitsPerBox, item.boxesPerCase, item.id]
            );
            res.json({ success: true });
        } else {
            // INSERT: Include inbound receiving details and calculate Unit Cost
            const unitCost = (item.invoiceCost && item.units > 0) ? (item.invoiceCost / item.units) : 0;
            
            item.id = Math.random().toString(36).substr(2, 9);
            await promisePool.query(
                `INSERT INTO inventory (id, sku, category_id, name, description, price, units, units_per_box, boxes_per_case, supplier, carrier, tracking, inbound_type, unit_type_rcv, invoice_cost, unit_cost) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
                [item.id, item.sku, item.catId, item.name, item.description, item.price, item.units, item.unitsPerBox, item.boxesPerCase, item.supplier, item.carrier, item.tracking, item.inboundType, item.unitTypeRcv, item.invoiceCost, unitCost]
            );
            res.json({ success: true, id: item.id });
        }
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/inventory/:id', async (req, res) => {
    try {
        await promisePool.query('DELETE FROM inventory WHERE id = ?', [req.params.id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/inventory/stock', async (req, res) => {
    const { id, units } = req.body;
    try {
        await promisePool.query('UPDATE inventory SET units = ?, last_mod = NOW() WHERE id = ?', [units, id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- CATEGORIES ---
app.get('/api/categories', async (req, res) => {
    try {
        const [rows] = await promisePool.query('SELECT * FROM categories');
        res.json(rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/categories', async (req, res) => {
    const { name } = req.body;
    try {
        const id = Math.random().toString(36).substr(2, 9);
        await promisePool.query('INSERT INTO categories (id, name) VALUES (?,?)', [id, name]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/categories/:id', async (req, res) => {
    try {
        await promisePool.query('DELETE FROM categories WHERE id = ?', [req.params.id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- USERS ---
app.get('/api/users', async (req, res) => {
    try {
        // Do not return password in list
        const [rows] = await promisePool.query('SELECT id, email, role, created_at FROM users');
        res.json(rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/users', async (req, res) => {
    const { email, password, role } = req.body;
    try {
        const id = Math.random().toString(36).substr(2, 9);
        await promisePool.query('INSERT INTO users (id, email, password, role) VALUES (?,?,?,?)', [id, email, password, role]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/users/:id', async (req, res) => {
    try {
        await promisePool.query('DELETE FROM users WHERE id = ?', [req.params.id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- HISTORY ---
app.get('/api/history', async (req, res) => {
    try {
        const [rows] = await promisePool.query('SELECT * FROM history ORDER BY timestamp DESC');
        res.json(rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/history', async (req, res) => {
    const { userEmail, userRole, action, details } = req.body;
    try {
        const id = Math.random().toString(36).substr(2, 9);
        await promisePool.query('INSERT INTO history (id, user_email, user_role, action, details) VALUES (?,?,?,?,?)', 
            [id, userEmail, userRole, action, details]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- CONFIGURATION (UPDATED FOR LOGO, THEME, AND NAME) ---
app.get('/api/config', async (req, res) => {
    try {
        const [rows] = await promisePool.query('SELECT * FROM config WHERE id = 1');
        res.json(rows[0]);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/config', async (req, res) => {
    const { systemName, lowStockThreshold, logoUrl, themeColor } = req.body;
    try {
        // Updated SQL to include logo_url and theme_color
        await promisePool.query(
            'UPDATE config SET system_name = ?, low_stock_threshold = ?, logo_url = ?, theme_color = ? WHERE id = 1', 
            [systemName, lowStockThreshold, logoUrl, themeColor]
        );
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`CardFolio Server running on http://localhost:${PORT}`);
});