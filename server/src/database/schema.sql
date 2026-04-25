-- UNO Game Database Schema
-- Run this script in SSMS against the IERPDB database

-- Players table
IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='UNO_Players' AND xtype='U')
CREATE TABLE UNO_Players (
    player_id INT IDENTITY(1,1) PRIMARY KEY,
    username NVARCHAR(50) NOT NULL UNIQUE,
    password_hash NVARCHAR(255) NOT NULL,
    display_name NVARCHAR(100) NOT NULL,
    games_played INT DEFAULT 0,
    games_won INT DEFAULT 0,
    total_score INT DEFAULT 0,
    created_at DATETIME DEFAULT GETDATE(),
    last_login DATETIME DEFAULT GETDATE(),
    is_online BIT DEFAULT 0
);

-- Games table
IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='UNO_Games' AND xtype='U')
CREATE TABLE UNO_Games (
    game_id INT IDENTITY(1,1) PRIMARY KEY,
    room_code NVARCHAR(10) NOT NULL UNIQUE,
    host_player_id INT NOT NULL,
    status NVARCHAR(20) DEFAULT 'waiting', -- waiting, playing, finished
    max_players INT DEFAULT 4,
    current_turn_player_id INT NULL,
    direction INT DEFAULT 1, -- 1 = clockwise, -1 = counter-clockwise
    current_color NVARCHAR(10) NULL,
    current_value NVARCHAR(20) NULL,
    winner_player_id INT NULL,
    created_at DATETIME DEFAULT GETDATE(),
    started_at DATETIME NULL,
    ended_at DATETIME NULL,
    FOREIGN KEY (host_player_id) REFERENCES UNO_Players(player_id),
    FOREIGN KEY (winner_player_id) REFERENCES UNO_Players(player_id)
);

-- Game Players (junction table)
IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='UNO_GamePlayers' AND xtype='U')
CREATE TABLE UNO_GamePlayers (
    id INT IDENTITY(1,1) PRIMARY KEY,
    game_id INT NOT NULL,
    player_id INT NOT NULL,
    seat_position INT NOT NULL,
    card_count INT DEFAULT 0,
    has_called_uno BIT DEFAULT 0,
    is_active BIT DEFAULT 1,
    joined_at DATETIME DEFAULT GETDATE(),
    FOREIGN KEY (game_id) REFERENCES UNO_Games(game_id),
    FOREIGN KEY (player_id) REFERENCES UNO_Players(player_id),
    UNIQUE(game_id, player_id),
    UNIQUE(game_id, seat_position)
);

-- Player Hands (cards in each player's hand)
IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='UNO_PlayerHands' AND xtype='U')
CREATE TABLE UNO_PlayerHands (
    id INT IDENTITY(1,1) PRIMARY KEY,
    game_id INT NOT NULL,
    player_id INT NOT NULL,
    card_color NVARCHAR(10) NOT NULL, -- red, blue, green, yellow, wild
    card_value NVARCHAR(20) NOT NULL, -- 0-9, skip, reverse, draw2, wild, wild_draw4
    card_order INT DEFAULT 0,
    FOREIGN KEY (game_id) REFERENCES UNO_Games(game_id),
    FOREIGN KEY (player_id) REFERENCES UNO_Players(player_id)
);

-- Draw Pile
IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='UNO_DrawPile' AND xtype='U')
CREATE TABLE UNO_DrawPile (
    id INT IDENTITY(1,1) PRIMARY KEY,
    game_id INT NOT NULL,
    card_color NVARCHAR(10) NOT NULL,
    card_value NVARCHAR(20) NOT NULL,
    pile_order INT NOT NULL,
    FOREIGN KEY (game_id) REFERENCES UNO_Games(game_id)
);

-- Discard Pile
IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='UNO_DiscardPile' AND xtype='U')
CREATE TABLE UNO_DiscardPile (
    id INT IDENTITY(1,1) PRIMARY KEY,
    game_id INT NOT NULL,
    card_color NVARCHAR(10) NOT NULL,
    card_value NVARCHAR(20) NOT NULL,
    played_by_player_id INT NULL,
    pile_order INT NOT NULL,
    played_at DATETIME DEFAULT GETDATE(),
    FOREIGN KEY (game_id) REFERENCES UNO_Games(game_id),
    FOREIGN KEY (played_by_player_id) REFERENCES UNO_Players(player_id)
);

-- Game Log (for replay/history)
IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='UNO_GameLog' AND xtype='U')
CREATE TABLE UNO_GameLog (
    id INT IDENTITY(1,1) PRIMARY KEY,
    game_id INT NOT NULL,
    player_id INT NULL,
    action_type NVARCHAR(50) NOT NULL, -- play_card, draw_card, call_uno, skip, reverse, etc.
    card_color NVARCHAR(10) NULL,
    card_value NVARCHAR(20) NULL,
    description NVARCHAR(255) NULL,
    created_at DATETIME DEFAULT GETDATE(),
    FOREIGN KEY (game_id) REFERENCES UNO_Games(game_id),
    FOREIGN KEY (player_id) REFERENCES UNO_Players(player_id)
);

-- Match History
IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='UNO_MatchHistory' AND xtype='U')
CREATE TABLE UNO_MatchHistory (
    id INT IDENTITY(1,1) PRIMARY KEY,
    game_id INT NOT NULL,
    player_id INT NOT NULL,
    final_position INT NOT NULL,
    score INT DEFAULT 0,
    played_at DATETIME DEFAULT GETDATE(),
    FOREIGN KEY (game_id) REFERENCES UNO_Games(game_id),
    FOREIGN KEY (player_id) REFERENCES UNO_Players(player_id)
);

PRINT 'UNO Game tables created successfully!';
