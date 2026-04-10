-- 📌 RESET SCHEMA (For Migration)
DROP TABLE IF EXISTS payments;
DROP TABLE IF EXISTS trips;
DROP TABLE IF EXISTS bookings;
DROP TABLE IF EXISTS vehicles;
DROP TABLE IF EXISTS drivers;





























DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS rides; -- Cleanup old table
DROP VIEW IF EXISTS fleet_report;
DROP VIEW IF EXISTS ride_summary;

-- 📌 TABLE STRUCTURE

-- 1. Users (Basic Identity for Customers & Admins)
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    phone TEXT,
    rating REAL DEFAULT 5.0,
    role TEXT CHECK(role IN ('passenger', 'admin')) DEFAULT 'passenger',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 2. Drivers (Professional Credentials)
CREATE TABLE IF NOT EXISTS drivers (
    driver_id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    phone TEXT NOT NULL,
    license_no TEXT UNIQUE NOT NULL,
    rating REAL DEFAULT 5.0,
    availability_status TEXT CHECK(availability_status IN ('available', 'busy', 'offline')) DEFAULT 'available',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 3. Vehicles (Hardware Link)
CREATE TABLE IF NOT EXISTS vehicles (
    vehicle_id INTEGER PRIMARY KEY AUTOINCREMENT,
    driver_id INTEGER NOT NULL UNIQUE, -- 1:1 Relationship
    model TEXT NOT NULL,
    number_plate TEXT UNIQUE NOT NULL,
    type TEXT CHECK(type IN ('Mini', 'Sedan', 'SUV')) DEFAULT 'Sedan',
    FOREIGN KEY (driver_id) REFERENCES drivers(driver_id) ON DELETE CASCADE
);

-- 4. Bookings (The Request)
CREATE TABLE IF NOT EXISTS bookings (
    booking_id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER NOT NULL,
    driver_id INTEGER,
    pickup_location TEXT NOT NULL,
    dropoff_location TEXT NOT NULL,
    booking_time DATETIME DEFAULT CURRENT_TIMESTAMP,
    status TEXT CHECK(status IN ('pending', 'accepted', 'ongoing', 'completed', 'cancelled')) DEFAULT 'pending',
    FOREIGN KEY (customer_id) REFERENCES users(id),
    FOREIGN KEY (driver_id) REFERENCES drivers(driver_id)
);

-- 5. Trips (The Execution)
CREATE TABLE IF NOT EXISTS trips (
    trip_id INTEGER PRIMARY KEY AUTOINCREMENT,
    booking_id INTEGER NOT NULL UNIQUE, -- 1:1 Relationship
    start_time DATETIME,
    end_time DATETIME,
    distance REAL,
    fare REAL,
    FOREIGN KEY (booking_id) REFERENCES bookings(booking_id) ON DELETE CASCADE
);

-- 6. Payments (The Transaction)
CREATE TABLE IF NOT EXISTS payments (
    payment_id INTEGER PRIMARY KEY AUTOINCREMENT,
    trip_id INTEGER NOT NULL UNIQUE, -- 1:1 Relationship
    amount REAL NOT NULL,
    payment_mode TEXT CHECK(payment_mode IN ('Cash', 'Card', 'Wallet')) DEFAULT 'Card',
    payment_status TEXT CHECK(payment_status IN ('pending', 'paid', 'failed')) DEFAULT 'pending',
    FOREIGN KEY (trip_id) REFERENCES trips(trip_id) ON DELETE CASCADE
);

-- 📌 VIEWS (For Advanced Reporting)
CREATE VIEW IF NOT EXISTS fleet_report AS
SELECT 
    d.driver_id,
    d.name AS driver_name,
    d.license_no,
    v.model,
    v.number_plate,
    d.availability_status
FROM drivers d
JOIN vehicles v ON d.driver_id = v.driver_id;

-- 📌 TRIGGERS (For Behavioral Automation)

-- Automate Driver Status on Booking Accept
CREATE TRIGGER IF NOT EXISTS trg_booking_accept
AFTER UPDATE OF status ON bookings
FOR EACH ROW
WHEN NEW.status = 'accepted'
BEGIN
    UPDATE drivers SET availability_status = 'busy' WHERE driver_id = NEW.driver_id;
END;

-- Automate Driver Status and Trip Creation on Completion
CREATE TRIGGER IF NOT EXISTS trg_booking_complete
AFTER UPDATE OF status ON bookings
FOR EACH ROW
WHEN NEW.status = 'completed'
BEGIN
    -- Reset Driver
    UPDATE drivers SET availability_status = 'available' WHERE driver_id = NEW.driver_id;
    
    -- Auto-insert into Trips if not exists
    INSERT INTO trips (booking_id, start_time, end_time, fare)
    VALUES (NEW.booking_id, OLD.booking_time, CURRENT_TIMESTAMP, 100.0); -- Placeholder fare
END;
