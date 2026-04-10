const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const db = require('./db');
const path = require('path');

const app = express();
const PORT = 3001;

// Global SQL Log for "Interactive Engine" visualization
let sqlLog = [];
const logSQL = (query) => {
    sqlLog.unshift({ 
        timestamp: new Date().toLocaleTimeString(), 
        query: query.substring(0, 150) + (query.length > 150 ? '...' : '') 
    });
    if (sqlLog.length > 20) sqlLog.pop();
};

app.use(cors());
app.use(bodyParser.json());

// --- API v1 Routes ---

// 1. ENGINE LOGS
app.get('/api/v1/engine/logs', (req, res) => res.json(sqlLog));

// 2. AUTH
app.post('/api/v1/auth/login', (req, res) => {
    const { email, password } = req.body;
    const query = 'SELECT * FROM users WHERE email = ? AND password = ?';
    logSQL(query);
    db.get(query, [email, password], (err, user) => {
        if (err || !user) return res.status(401).json({ error: 'Invalid credentials' });
        res.json(user);
    });
});

app.post('/api/v1/auth/register', (req, res) => {
    const { name, email, password, phone } = req.body;
    const query = 'INSERT INTO users (name, email, password, phone) VALUES (?, ?, ?, ?)';
    logSQL(query);
    db.run(query, [name, email, password, phone], function(err) {
        if (err) return res.status(400).json({ error: 'Email already exists or invalid data' });
        db.get('SELECT * FROM users WHERE id = ?', [this.lastID], (err, user) => {
            res.json(user);
        });
    });
});

// 3. FLEET
app.get('/api/v1/drivers', (req, res) => {
    const query = 'SELECT * FROM fleet_report WHERE availability_status = "available"';
    logSQL(query);
    db.all(query, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.get('/api/v1/fleet', (req, res) => {
    const query = 'SELECT * FROM fleet_report';
    logSQL(query);
    db.all(query, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.post('/api/v1/fleet/register', (req, res) => {
    const { name, phone, license, model, plate, type } = req.body;
    db.serialize(() => {
        db.run('BEGIN TRANSACTION');
        const q1 = 'INSERT INTO drivers (name, phone, license_no) VALUES (?, ?, ?)';
        logSQL(q1);
        db.run(q1, [name, phone, license], function(err) {
            if (err) { db.run('ROLLBACK'); return res.status(500).json({ error: 'Driver exists' }); }
            const driverId = this.lastID;
            const q2 = 'INSERT INTO vehicles (driver_id, model, number_plate, type) VALUES (?, ?, ?, ?)';
            logSQL(q2);
            db.run(q2, [driverId, model, plate, type], function(err) {
                if (err) { db.run('ROLLBACK'); return res.status(500).json({ error: 'Plate exists' }); }
                db.run('COMMIT');
                res.json({ success: true, driverId });
            });
        });
    });
});

// 4. BOOKINGS
app.post('/api/v1/bookings', (req, res) => {
    const { customerId, driverId, pickup, dropoff, fare, distance } = req.body;
    
    // Server-side rounding to match frontend Math.round()
    const finalFare = Math.round(fare || 150);
    const finalDist = distance || 5;

    db.serialize(() => {
        db.run('BEGIN TRANSACTION');
        
        const q1 = 'INSERT INTO bookings (customer_id, driver_id, pickup_location, dropoff_location, status) VALUES (?, ?, ?, ?, "accepted")';
        logSQL(q1);
        
        db.run(q1, [customerId, driverId, pickup, dropoff], function(err) {
            if (err) {
                console.error('Booking Error:', err);
                db.run('ROLLBACK');
                return res.status(500).json({ error: err.message });
            }
            
            const bookingId = this.lastID;
            console.log(`Booking Created: ${bookingId}, Fare: ${finalFare}`);

            // Create Trip Record for DBMS Relation
            const q2 = 'INSERT INTO trips (booking_id, start_time, distance, fare) VALUES (?, datetime("now"), ?, ?)';
            logSQL(q2);
            
            db.run(q2, [bookingId, finalDist, finalFare], function(err) {
                if (err) {
                    console.error('Trip Error:', err);
                    db.run('ROLLBACK');
                    return res.status(500).json({ error: err.message });
                }
                
                db.run('COMMIT');
                res.json({ success: true, id: bookingId });
            });
        });
    });
});

app.get('/api/v1/history/:userId', (req, res) => {
    const query = `
        SELECT b.*, d.name as driver_name, v.model as vehicle_model, t.fare, t.distance
        FROM bookings b
        JOIN drivers d ON b.driver_id = d.driver_id
        JOIN vehicles v ON d.driver_id = v.driver_id
        LEFT JOIN trips t ON b.booking_id = t.booking_id
        WHERE b.customer_id = ?
        ORDER BY b.booking_time DESC
    `;
    logSQL(query);
    db.all(query, [req.params.userId], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// 5. LIVE ER TABLES
app.get('/api/v1/database/tables', (req, res) => {
    const tables = ['users', 'drivers', 'vehicles', 'bookings', 'trips', 'payments'];
    let result = {};
    let completed = 0;

    tables.forEach(table => {
        db.all(`SELECT * FROM ${table} LIMIT 10`, (err, rows) => {
            if (!err) result[table] = rows;
            completed++;
            if (completed === tables.length) {
                res.json(result);
            }
        });
    });
});

// 6. RAW TABLE DELETION
app.delete('/api/v1/database/tables/:table/:id', (req, res) => {
    const { table, id } = req.params;
    const allowedTables = ['users', 'drivers', 'vehicles', 'bookings', 'trips', 'payments'];
    if (!allowedTables.includes(table)) return res.status(400).json({ error: 'Invalid table' });

    let pk = table === 'users' ? 'id' : (table.slice(0, -1) + '_id'); 
    const query = `DELETE FROM ${table} WHERE ${pk} = ?`;
    logSQL(query);
    db.run(query, [id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true, changes: this.changes });
    });
});

// Serve Static Files LAST
app.use(express.static(path.join(__dirname, '../client')));

// Start Server
app.listen(PORT, () => {
    console.log(`DriveFlow running at http://localhost:${PORT}`);
});
