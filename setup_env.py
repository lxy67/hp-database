import os
import getpass

def setup_environment():
    """Setup environment variables in .env file"""
    env_vars = {
        # Server Configuration
        'PORT': '3000',
        'JWT_SECRET': 'your_secure_jwt_secret_key_change_in_production',
        
        # Database Configuration (PostgreSQL)
        'DB_HOST': 'localhost',
        'DB_PORT': '5432',
        'DB_NAME': 'hpdata',
        'DB_USER': 'postgres',
        'DB_PASSWORD': '123456',
        
        # Email Configuration
        'EMAIL_HOST': 'smtp.example.com',
        'EMAIL_PORT': '587',
        'EMAIL_SECURE': 'false',
        'EMAIL_USER': '',
        'EMAIL_PASS': '',
        
        # Rate Limiting
        'RATE_LIMIT_WINDOW_MS': '900000',  # 15 minutes
        'RATE_LIMIT_MAX_REQUESTS': '100',
    }
    
    print("Setting up environment variables...")
    print("Leave blank to use default values shown in [brackets]")
    
    # Get user input for each variable
    for key, default in env_vars.items():
        if key in ['DB_PASSWORD', 'EMAIL_PASS']:
            # For sensitive fields, use getpass
            value = getpass.getpass(f"{key} [{'*' * len(default) if default else 'empty'}]: ") or default
        else:
            value = input(f"{key} [{default}]: ") or default
        env_vars[key] = value
    
    # Write to .env file
    with open('.env', 'w') as f:
        for key, value in env_vars.items():
            f.write(f"{key}={value}\n")
    
    print("\n.env file has been created successfully!")
    print("Please review the file and make any necessary changes.")
    print("Don't forget to keep this file secure and never commit it to version control.")

if __name__ == "__main__":
    if os.path.exists('.env'):
        response = input("A .env file already exists. Overwrite? (y/n): ")
        if response.lower() != 'y':
            print("Setup cancelled.")
            exit()
    
    setup_environment()
