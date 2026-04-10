const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const dbPath = path.resolve(__dirname, 'driveflow.db');
const schemaPath = path.resolve(__dirname, 'schema.sql');

const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Could not connect to database', err);
    } else {
        console.log('Connected to SQLite database');
        initializeDatabase();
    }
});

function initializeDatabase() {
    const schema = fs.readFileSync(schemaPath, 'utf8');
    db.exec(schema, (err) => {
        if (err) {
            console.error('Error initializing database schema', err);
        } else {
            console.log('Database schema initialized');
            seedData();
        }
    });
}

function seedData() {
    db.get('SELECT COUNT(*) as count FROM users', (err, row) => {
        if (row && row.count === 0) {
            console.log('Seeding initial data for 6-table relational model...');
            
            const queries = [
                "INSERT INTO users (name, email, password, phone, role) VALUES ('Amit Sharma', 'amit@example.com', 'pass123', '9876543210', 'passenger')",
                "INSERT INTO users (name, email, password, phone, role) VALUES ('Admin User', 'admin@driveflow.com', 'admin123', '0000000000', 'admin')",
                "INSERT INTO drivers (name, phone, license_no, rating, availability_status) VALUES ('Priya Patel', '8765432109', 'DL-IND-9988', 4.8, 'available')",
                "INSERT INTO drivers (name, phone, license_no, rating, availability_status) VALUES ('Rahul Varma', '6543210987', 'DL-IND-7766', 4.5, 'available')",
                "INSERT INTO vehicles (driver_id, model, number_plate, type) VALUES (1, 'Toyota Camry', 'MH-01-AB-1234', 'Sedan')",
                "INSERT INTO vehicles (driver_id, model, number_plate, type) VALUES (2, 'Hyundai Creta', 'KA-05-XY-9876', 'SUV')"
            ];

            db.serialize(() => {
                queries.forEach(q => db.run(q));
            });
        }
    });
}

module.exports = db;
