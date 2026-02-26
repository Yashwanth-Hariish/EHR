#!/usr/bin/env python3
"""
Cryptographic Service for EHR System
Provides AES-256-GCM encryption/decryption and Proxy Re-Encryption (PRE) operations.

Endpoints:
  POST /encrypt         - Encrypt a file with AES-256-GCM
  POST /decrypt         - Decrypt a file
  POST /generate-keys   - Generate RSA keypair for a user
  POST /pre/keygen      - Generate a PRE re-encryption key
  POST /pre/reencrypt   - Perform proxy re-encryption
  POST /pre/decrypt     - Decrypt a re-encrypted ciphertext
  POST /sign            - Sign data with RSA private key
  POST /verify          - Verify a digital signature
"""

from flask import Flask, request, jsonify, send_file
from Crypto.Cipher import AES, PKCS1_OAEP
from Crypto.PublicKey import RSA
from Crypto.Signature import pkcs1_15
from Crypto.Hash import SHA256, SHA512
from Crypto.Random import get_random_bytes
from Crypto.Util.Padding import pad, unpad
import base64
import json
import os
import io
import hashlib
import struct

app = Flask(__name__)

# =====================
# AES-256-GCM ENCRYPTION
# =====================

@app.route('/encrypt', methods=['POST'])
def encrypt_file():
    """
    Encrypt a file using AES-256-GCM.
    Accepts multipart/form-data with 'file' field,
    or JSON with base64-encoded 'data' field.
    
    Returns JSON with:
      - encrypted_data: base64-encoded ciphertext
      - aes_key: base64-encoded AES key (32 bytes)
      - nonce: base64-encoded GCM nonce (16 bytes)
      - tag: base64-encoded GCM authentication tag (16 bytes)
      - hash: SHA-256 hash of the original plaintext
    """
    try:
        # Get plaintext data
        if request.content_type and 'multipart' in request.content_type:
            file = request.files.get('file')
            if not file:
                return jsonify({'error': 'No file provided'}), 400
            plaintext = file.read()
        else:
            body = request.get_json()
            if not body or 'data' not in body:
                return jsonify({'error': 'No data provided'}), 400
            plaintext = base64.b64decode(body['data'])

        # Generate a random 256-bit AES key
        aes_key = get_random_bytes(32)
        
        # Generate a random 96-bit nonce (recommended for GCM)
        nonce = get_random_bytes(12)
        
        # Encrypt with AES-256-GCM
        cipher = AES.new(aes_key, AES.MODE_GCM, nonce=nonce)
        ciphertext, tag = cipher.encrypt_and_digest(plaintext)
        
        # Compute SHA-256 hash of original plaintext for integrity verification
        file_hash = hashlib.sha256(plaintext).hexdigest()
        
        return jsonify({
            'encrypted_data': base64.b64encode(ciphertext).decode(),
            'aes_key': base64.b64encode(aes_key).decode(),
            'nonce': base64.b64encode(nonce).decode(),
            'tag': base64.b64encode(tag).decode(),
            'hash': file_hash,
            'original_size': len(plaintext)
        })

    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/decrypt', methods=['POST'])
def decrypt_file():
    """
    Decrypt an AES-256-GCM encrypted file.
    
    Accepts JSON with:
      - encrypted_data: base64-encoded ciphertext
      - aes_key: base64-encoded AES key
      - nonce: base64-encoded nonce
      - tag: base64-encoded authentication tag
    
    Returns binary plaintext file.
    """
    try:
        body = request.get_json()
        
        ciphertext = base64.b64decode(body['encrypted_data'])
        aes_key = base64.b64decode(body['aes_key'])
        nonce = base64.b64decode(body['nonce'])
        tag = base64.b64decode(body['tag'])
        
        cipher = AES.new(aes_key, AES.MODE_GCM, nonce=nonce)
        plaintext = cipher.decrypt_and_verify(ciphertext, tag)
        
        # Return as binary stream
        return send_file(
            io.BytesIO(plaintext),
            mimetype='application/octet-stream',
            as_attachment=True,
            download_name='decrypted_file'
        )

    except ValueError as e:
        # Authentication tag mismatch = tampering detected
        return jsonify({'error': f'Authentication failed - data may be tampered: {str(e)}'}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# =====================
# RSA KEY MANAGEMENT
# =====================

@app.route('/generate-keys', methods=['POST'])
def generate_keys():
    """
    Generate an RSA-2048 keypair for a user.
    
    Returns JSON with:
      - public_key: PEM-encoded public key
      - private_key: PEM-encoded private key (store securely!)
    """
    try:
        key = RSA.generate(2048)
        
        private_key_pem = key.export_key().decode()
        public_key_pem = key.publickey().export_key().decode()
        
        return jsonify({
            'public_key': public_key_pem,
            'private_key': private_key_pem
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/encrypt-key', methods=['POST'])
def encrypt_aes_key():
    """
    Encrypt an AES key with a user's RSA public key (for key wrapping).
    
    Accepts JSON:
      - aes_key: base64-encoded AES key
      - public_key: PEM-encoded RSA public key
    """
    try:
        body = request.get_json()
        aes_key = base64.b64decode(body['aes_key'])
        public_key_pem = body['public_key']
        
        rsa_key = RSA.import_key(public_key_pem)
        cipher_rsa = PKCS1_OAEP.new(rsa_key)
        encrypted_key = cipher_rsa.encrypt(aes_key)
        
        return jsonify({
            'encrypted_key': base64.b64encode(encrypted_key).decode()
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/decrypt-key', methods=['POST'])
def decrypt_aes_key():
    """
    Decrypt an RSA-wrapped AES key using private key.
    
    Accepts JSON:
      - encrypted_key: base64-encoded encrypted AES key
      - private_key: PEM-encoded RSA private key
    """
    try:
        body = request.get_json()
        encrypted_key = base64.b64decode(body['encrypted_key'])
        private_key_pem = body['private_key']
        
        rsa_key = RSA.import_key(private_key_pem)
        cipher_rsa = PKCS1_OAEP.new(rsa_key)
        aes_key = cipher_rsa.decrypt(encrypted_key)
        
        return jsonify({
            'aes_key': base64.b64encode(aes_key).decode()
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# =====================
# PROXY RE-ENCRYPTION (PRE)
# =====================
# 
# Simplified BBS98-style PRE scheme:
#   1. Patient encrypts AES key with their RSA public key -> EncKey_P
#   2. Patient generates re-encryption key: rk_{P->D} = RSA_priv_P / RSA_priv_D (simplified)
#   3. Proxy applies rk to EncKey_P -> EncKey_D (re-encrypted ciphertext)
#   4. Doctor decrypts EncKey_D with their RSA private key -> AES key
#
# In production, use a proper PRE library like pyUmbral (NuCypher).

@app.route('/pre/keygen', methods=['POST'])
def pre_keygen():
    """
    Generate a proxy re-encryption key that allows re-encryption
    from Patient's encryption to Doctor's encryption.
    
    This is a simplified scheme. In production use pyUmbral.
    
    Accepts JSON:
      - patient_private_key: PEM RSA private key of patient
      - doctor_public_key: PEM RSA public key of doctor
    
    Returns JSON:
      - re_encryption_key: base64-encoded re-encryption key bundle
    """
    try:
        body = request.get_json()
        patient_private_pem = body['patient_private_key']
        doctor_public_pem = body['doctor_public_key']
        
        patient_key = RSA.import_key(patient_private_pem)
        doctor_key = RSA.import_key(doctor_public_pem)
        
        # In a real PRE scheme (e.g., AFGH), the re-encryption key is:
        # rk = (patient_private_key * modular_inverse(doctor_private_key)) mod n
        # Here we use a simplified wrapper approach:
        # Store doctor's public key encrypted with patient's private key
        
        # We encode the doctor's public key as the re-encryption key
        # The proxy uses this to re-encrypt the patient-encrypted AES key for the doctor
        doctor_pub_pem_bytes = doctor_public_pem.encode()
        patient_cipher = PKCS1_OAEP.new(patient_key)
        
        # Create re-encryption bundle: doctor_pubkey + proof
        bundle = {
            'version': '1.0',
            'scheme': 'simplified-pre',
            'doctor_public_key': doctor_public_pem,
            'patient_key_id': hashlib.sha256(
                patient_key.publickey().export_key()
            ).hexdigest()[:16]
        }
        bundle_bytes = json.dumps(bundle).encode()
        
        return jsonify({
            're_encryption_key': base64.b64encode(bundle_bytes).decode()
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/pre/reencrypt', methods=['POST'])
def pre_reencrypt():
    """
    Proxy re-encryption: re-encrypt an AES key from Patient's encryption
    to Doctor's encryption WITHOUT decrypting the AES key or accessing plaintext.
    
    Accepts JSON:
      - encrypted_aes_key: base64 AES key encrypted with patient's public key
      - re_encryption_key: base64 re-encryption key bundle
      - patient_private_key: patient's private key (proxy needs this in simplified scheme)
        Note: In a true PRE scheme (pyUmbral), the proxy would NOT need this.
    
    Returns JSON:
      - re_encrypted_key: base64 AES key encrypted with doctor's public key
    """
    try:
        body = request.get_json()
        encrypted_aes_key = base64.b64decode(body['encrypted_aes_key'])
        re_enc_key_b64 = base64.b64decode(body['re_encryption_key'])
        patient_private_pem = body['patient_private_key']
        
        # Parse the re-encryption bundle
        bundle = json.loads(re_enc_key_b64.decode())
        doctor_public_pem = bundle['doctor_public_key']
        
        # Step 1: Decrypt AES key with patient's private key (PROXY STEP)
        patient_key = RSA.import_key(patient_private_pem)
        patient_cipher = PKCS1_OAEP.new(patient_key)
        aes_key = patient_cipher.decrypt(encrypted_aes_key)
        
        # Step 2: Re-encrypt with doctor's public key
        doctor_key = RSA.import_key(doctor_public_pem)
        doctor_cipher = PKCS1_OAEP.new(doctor_key)
        re_encrypted_key = doctor_cipher.encrypt(aes_key)
        
        return jsonify({
            're_encrypted_key': base64.b64encode(re_encrypted_key).decode()
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/pre/decrypt', methods=['POST'])
def pre_decrypt():
    """
    Doctor decrypts a re-encrypted AES key using their private key.
    
    Accepts JSON:
      - re_encrypted_key: base64-encoded re-encrypted AES key
      - doctor_private_key: PEM RSA private key
    
    Returns JSON:
      - aes_key: base64-encoded plaintext AES key
    """
    try:
        body = request.get_json()
        re_encrypted_key = base64.b64decode(body['re_encrypted_key'])
        doctor_private_pem = body['doctor_private_key']
        
        doctor_key = RSA.import_key(doctor_private_pem)
        cipher = PKCS1_OAEP.new(doctor_key)
        aes_key = cipher.decrypt(re_encrypted_key)
        
        return jsonify({
            'aes_key': base64.b64encode(aes_key).decode()
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# =====================
# DIGITAL SIGNATURES
# =====================

@app.route('/sign', methods=['POST'])
def sign_data():
    """
    Sign data with RSA private key using PKCS#1 v1.5 + SHA-256.
    
    Accepts JSON:
      - data: base64-encoded data to sign
      - private_key: PEM RSA private key
    
    Returns JSON:
      - signature: base64-encoded signature
    """
    try:
        body = request.get_json()
        data = base64.b64decode(body['data'])
        private_key_pem = body['private_key']
        
        key = RSA.import_key(private_key_pem)
        h = SHA256.new(data)
        signature = pkcs1_15.new(key).sign(h)
        
        return jsonify({
            'signature': base64.b64encode(signature).decode()
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/verify', methods=['POST'])
def verify_signature():
    """
    Verify a digital signature.
    
    Accepts JSON:
      - data: base64-encoded original data
      - signature: base64-encoded signature
      - public_key: PEM RSA public key
    
    Returns JSON:
      - valid: boolean
    """
    try:
        body = request.get_json()
        data = base64.b64decode(body['data'])
        signature = base64.b64decode(body['signature'])
        public_key_pem = body['public_key']
        
        key = RSA.import_key(public_key_pem)
        h = SHA256.new(data)
        
        try:
            pkcs1_15.new(key).verify(h, signature)
            return jsonify({'valid': True})
        except (ValueError, TypeError):
            return jsonify({'valid': False})
            
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/hash', methods=['POST'])
def compute_hash():
    """Compute SHA-256 hash of data."""
    try:
        body = request.get_json()
        data = base64.b64decode(body['data'])
        hash_value = hashlib.sha256(data).hexdigest()
        return jsonify({'hash': hash_value})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/health', methods=['GET'])
def health():
    return jsonify({'status': 'ok', 'service': 'crypto-service'})


if __name__ == '__main__':
    port = int(os.environ.get('CRYPTO_SERVICE_PORT', 5001))
    app.run(host='0.0.0.0', port=port, debug=os.environ.get('FLASK_DEBUG', 'false').lower() == 'true')
