package main

import (
	"encoding/json"
	"fmt"
	"time"

	"github.com/hyperledger/fabric-contract-api-go/contractapi"
)

// EHRContract defines the smart contract
type EHRContract struct {
	contractapi.Contract
}

// =====================
// DATA STRUCTURES
// =====================

type Role string

const (
	RoleAdmin   Role = "ADMIN"
	RoleDoctor  Role = "DOCTOR"
	RolePatient Role = "PATIENT"
)

// User represents a system user
type User struct {
	UserID    string `json:"userId"`
	Name      string `json:"name"`
	Role      Role   `json:"role"`
	PublicKey string `json:"publicKey"`
	Active    bool   `json:"active"`
	CreatedAt string `json:"createdAt"`
	UpdatedAt string `json:"updatedAt"`
}

// HealthRecord represents an EHR metadata entry on-chain
type HealthRecord struct {
	RecordID        string `json:"recordId"`
	PatientID       string `json:"patientId"`
	DoctorID        string `json:"doctorId"`
	RecordType      string `json:"recordType"`
	IPFSCid         string `json:"ipfsCid"`
	EncryptedAESKey string `json:"encryptedAesKey"` // AES key encrypted with patient's public key
	Timestamp       string `json:"timestamp"`
	Signature       string `json:"signature"`
	Hash            string `json:"hash"`
	Active          bool   `json:"active"`
}

// AccessGrant represents a delegated access entry
type AccessGrant struct {
	GrantID         string `json:"grantId"`
	RecordID        string `json:"recordId"`
	PatientID       string `json:"patientId"`
	DoctorID        string `json:"doctorId"`
	ReEncryptionKey string `json:"reEncryptionKey"` // PRE re-encryption key
	GrantedAt       string `json:"grantedAt"`
	RevokedAt       string `json:"revokedAt,omitempty"`
	Active          bool   `json:"active"`
}

// AuditLog represents an immutable audit entry
type AuditLog struct {
	LogID     string `json:"logId"`
	UserID    string `json:"userId"`
	Action    string `json:"action"`
	Resource  string `json:"resource"`
	Timestamp string `json:"timestamp"`
	TxID      string `json:"txId"`
	Details   string `json:"details"`
}

// =====================
// USER MANAGEMENT
// =====================

// CreateUser - Admin only: registers a new user on the ledger
func (c *EHRContract) CreateUser(ctx contractapi.TransactionContextInterface,
	userID, name, roleStr, publicKey string) error {

	if err := c.requireRole(ctx, RoleAdmin); err != nil {
		return err
	}

	existing, err := ctx.GetStub().GetState("USER_" + userID)
	if err != nil {
		return fmt.Errorf("failed to read state: %v", err)
	}
	if existing != nil {
		return fmt.Errorf("user %s already exists", userID)
	}

	role := Role(roleStr)
	if role != RoleAdmin && role != RoleDoctor && role != RolePatient {
		return fmt.Errorf("invalid role: %s", roleStr)
	}

	now := time.Now().UTC().Format(time.RFC3339)
	user := User{
		UserID:    userID,
		Name:      name,
		Role:      role,
		PublicKey: publicKey,
		Active:    true,
		CreatedAt: now,
		UpdatedAt: now,
	}

	data, _ := json.Marshal(user)
	if err := ctx.GetStub().PutState("USER_"+userID, data); err != nil {
		return err
	}

	return c.writeAuditLog(ctx, userID, "CREATE_USER", "USER_"+userID, "User created with role "+roleStr)
}

// DeactivateUser - Admin only
func (c *EHRContract) DeactivateUser(ctx contractapi.TransactionContextInterface, userID string) error {
	if err := c.requireRole(ctx, RoleAdmin); err != nil {
		return err
	}

	user, err := c.getUser(ctx, userID)
	if err != nil {
		return err
	}

	user.Active = false
	user.UpdatedAt = time.Now().UTC().Format(time.RFC3339)

	data, _ := json.Marshal(user)
	if err := ctx.GetStub().PutState("USER_"+userID, data); err != nil {
		return err
	}

	callerID, _ := ctx.GetClientIdentity().GetID()
	return c.writeAuditLog(ctx, callerID, "DEACTIVATE_USER", "USER_"+userID, "User deactivated")
}

// GetUser - Returns a user record
func (c *EHRContract) GetUser(ctx contractapi.TransactionContextInterface, userID string) (*User, error) {
	return c.getUser(ctx, userID)
}

// =====================
// HEALTH RECORD MANAGEMENT
// =====================

// CreateHealthRecord - Doctor only: stores record metadata on-chain
func (c *EHRContract) CreateHealthRecord(ctx contractapi.TransactionContextInterface,
	recordID, patientID, recordType, ipfsCid, encryptedAESKey, signature, hash string) error {

	if err := c.requireRole(ctx, RoleDoctor); err != nil {
		return err
	}

	// Verify patient exists
	if _, err := c.getUser(ctx, patientID); err != nil {
		return fmt.Errorf("patient not found: %v", err)
	}

	existing, err := ctx.GetStub().GetState("RECORD_" + recordID)
	if err != nil {
		return err
	}
	if existing != nil {
		return fmt.Errorf("record %s already exists", recordID)
	}

	doctorID, _ := ctx.GetClientIdentity().GetID()
	now := time.Now().UTC().Format(time.RFC3339)

	record := HealthRecord{
		RecordID:        recordID,
		PatientID:       patientID,
		DoctorID:        doctorID,
		RecordType:      recordType,
		IPFSCid:         ipfsCid,
		EncryptedAESKey: encryptedAESKey,
		Timestamp:       now,
		Signature:       signature,
		Hash:            hash,
		Active:          true,
	}

	data, _ := json.Marshal(record)
	if err := ctx.GetStub().PutState("RECORD_"+recordID, data); err != nil {
		return err
	}

	// Index record for patient lookup
	indexKey, _ := ctx.GetStub().CreateCompositeKey("PATIENT_RECORD", []string{patientID, recordID})
	ctx.GetStub().PutState(indexKey, []byte{0x00})

	return c.writeAuditLog(ctx, doctorID, "CREATE_RECORD", "RECORD_"+recordID,
		fmt.Sprintf("Record created for patient %s, IPFS CID: %s", patientID, ipfsCid))
}

// GetHealthRecord - Returns record if caller is authorized
func (c *EHRContract) GetHealthRecord(ctx contractapi.TransactionContextInterface, recordID string) (*HealthRecord, error) {
	record, err := c.getRecord(ctx, recordID)
	if err != nil {
		return nil, err
	}

	callerID, _ := ctx.GetClientIdentity().GetID()
	callerRole, _ := c.getCallerRole(ctx)

	authorized := false
	switch callerRole {
	case RoleAdmin:
		// Admins can see metadata but this is logged
		authorized = true
	case RoleDoctor:
		authorized = record.DoctorID == callerID || c.hasAccessGrant(ctx, record.RecordID, callerID)
	case RolePatient:
		authorized = record.PatientID == callerID
	}

	if !authorized {
		c.writeAuditLog(ctx, callerID, "UNAUTHORIZED_ACCESS", "RECORD_"+recordID, "Access denied")
		return nil, fmt.Errorf("access denied: insufficient permissions")
	}

	c.writeAuditLog(ctx, callerID, "GET_RECORD", "RECORD_"+recordID, "Record accessed")
	return record, nil
}

// GetPatientRecords - Returns all records for a patient
func (c *EHRContract) GetPatientRecords(ctx contractapi.TransactionContextInterface, patientID string) ([]*HealthRecord, error) {
	callerID, _ := ctx.GetClientIdentity().GetID()
	callerRole, _ := c.getCallerRole(ctx)

	if callerRole == RolePatient && callerID != patientID {
		return nil, fmt.Errorf("access denied: patients can only view their own records")
	}
	if callerRole == RoleAdmin {
		return nil, fmt.Errorf("access denied: admins cannot view medical records")
	}

	iterator, err := ctx.GetStub().GetStateByPartialCompositeKey("PATIENT_RECORD", []string{patientID})
	if err != nil {
		return nil, err
	}
	defer iterator.Close()

	var records []*HealthRecord
	for iterator.HasNext() {
		item, err := iterator.Next()
		if err != nil {
			continue
		}
		_, components, _ := ctx.GetStub().SplitCompositeKey(item.Key)
		if len(components) < 2 {
			continue
		}
		record, err := c.getRecord(ctx, components[1])
		if err != nil || !record.Active {
			continue
		}
		// For doctors, only include records they have access to
		if callerRole == RoleDoctor {
			if record.DoctorID != callerID && !c.hasAccessGrant(ctx, record.RecordID, callerID) {
				continue
			}
		}
		records = append(records, record)
	}

	c.writeAuditLog(ctx, callerID, "LIST_RECORDS", "PATIENT_"+patientID, fmt.Sprintf("Listed %d records", len(records)))
	return records, nil
}

// =====================
// ACCESS DELEGATION (PRE)
// =====================

// GrantAccess - Patient only: grants a doctor access to a specific record
func (c *EHRContract) GrantAccess(ctx contractapi.TransactionContextInterface,
	grantID, recordID, doctorID, reEncryptionKey string) error {

	if err := c.requireRole(ctx, RolePatient); err != nil {
		return err
	}

	patientID, _ := ctx.GetClientIdentity().GetID()

	// Verify record belongs to this patient
	record, err := c.getRecord(ctx, recordID)
	if err != nil {
		return err
	}
	if record.PatientID != patientID {
		return fmt.Errorf("access denied: record does not belong to this patient")
	}

	// Verify doctor exists
	doctor, err := c.getUser(ctx, doctorID)
	if err != nil {
		return fmt.Errorf("doctor not found: %v", err)
	}
	if doctor.Role != RoleDoctor {
		return fmt.Errorf("target user is not a doctor")
	}

	now := time.Now().UTC().Format(time.RFC3339)
	grant := AccessGrant{
		GrantID:         grantID,
		RecordID:        recordID,
		PatientID:       patientID,
		DoctorID:        doctorID,
		ReEncryptionKey: reEncryptionKey,
		GrantedAt:       now,
		Active:          true,
	}

	data, _ := json.Marshal(grant)
	key := fmt.Sprintf("GRANT_%s_%s_%s", recordID, patientID, doctorID)
	if err := ctx.GetStub().PutState(key, data); err != nil {
		return err
	}

	// Index for lookup
	indexKey, _ := ctx.GetStub().CreateCompositeKey("ACCESS_GRANT", []string{recordID, doctorID})
	ctx.GetStub().PutState(indexKey, []byte(grantID))

	return c.writeAuditLog(ctx, patientID, "GRANT_ACCESS", "RECORD_"+recordID,
		fmt.Sprintf("Access granted to doctor %s", doctorID))
}

// RevokeAccess - Patient only: revokes a doctor's access
func (c *EHRContract) RevokeAccess(ctx contractapi.TransactionContextInterface,
	recordID, doctorID string) error {

	if err := c.requireRole(ctx, RolePatient); err != nil {
		return err
	}

	patientID, _ := ctx.GetClientIdentity().GetID()

	record, err := c.getRecord(ctx, recordID)
	if err != nil {
		return err
	}
	if record.PatientID != patientID {
		return fmt.Errorf("access denied")
	}

	key := fmt.Sprintf("GRANT_%s_%s_%s", recordID, patientID, doctorID)
	data, err := ctx.GetStub().GetState(key)
	if err != nil || data == nil {
		return fmt.Errorf("access grant not found")
	}

	var grant AccessGrant
	json.Unmarshal(data, &grant)
	grant.Active = false
	grant.RevokedAt = time.Now().UTC().Format(time.RFC3339)

	updated, _ := json.Marshal(grant)
	if err := ctx.GetStub().PutState(key, updated); err != nil {
		return err
	}

	// Remove index
	indexKey, _ := ctx.GetStub().CreateCompositeKey("ACCESS_GRANT", []string{recordID, doctorID})
	ctx.GetStub().DelState(indexKey)

	return c.writeAuditLog(ctx, patientID, "REVOKE_ACCESS", "RECORD_"+recordID,
		fmt.Sprintf("Access revoked from doctor %s", doctorID))
}

// GetAccessGrant - Returns the active grant for a record/doctor pair
func (c *EHRContract) GetAccessGrant(ctx contractapi.TransactionContextInterface,
	recordID, doctorID string) (*AccessGrant, error) {

	callerID, _ := ctx.GetClientIdentity().GetID()
	callerRole, _ := c.getCallerRole(ctx)

	// Only the relevant doctor or the patient can fetch the grant
	if callerRole == RoleDoctor && callerID != doctorID {
		return nil, fmt.Errorf("access denied")
	}

	record, err := c.getRecord(ctx, recordID)
	if err != nil {
		return nil, err
	}
	if callerRole == RolePatient && callerID != record.PatientID {
		return nil, fmt.Errorf("access denied")
	}

	key := fmt.Sprintf("GRANT_%s_%s_%s", recordID, record.PatientID, doctorID)
	data, err := ctx.GetStub().GetState(key)
	if err != nil || data == nil {
		return nil, fmt.Errorf("grant not found")
	}

	var grant AccessGrant
	json.Unmarshal(data, &grant)
	if !grant.Active {
		return nil, fmt.Errorf("grant has been revoked")
	}

	return &grant, nil
}

// GetMyAccessGrants - Patient: list all active grants for their records
func (c *EHRContract) GetMyAccessGrants(ctx contractapi.TransactionContextInterface, recordID string) ([]*AccessGrant, error) {
	if err := c.requireRole(ctx, RolePatient); err != nil {
		return nil, err
	}

	patientID, _ := ctx.GetClientIdentity().GetID()
	record, err := c.getRecord(ctx, recordID)
	if err != nil {
		return nil, err
	}
	if record.PatientID != patientID {
		return nil, fmt.Errorf("access denied")
	}

	iterator, err := ctx.GetStub().GetStateByPartialCompositeKey("ACCESS_GRANT", []string{recordID})
	if err != nil {
		return nil, err
	}
	defer iterator.Close()

	var grants []*AccessGrant
	for iterator.HasNext() {
		item, err := iterator.Next()
		if err != nil {
			continue
		}
		_, components, _ := ctx.GetStub().SplitCompositeKey(item.Key)
		if len(components) < 2 {
			continue
		}
		key := fmt.Sprintf("GRANT_%s_%s_%s", recordID, patientID, components[1])
		data, err := ctx.GetStub().GetState(key)
		if err != nil || data == nil {
			continue
		}
		var grant AccessGrant
		json.Unmarshal(data, &grant)
		if grant.Active {
			grants = append(grants, &grant)
		}
	}

	return grants, nil
}

// =====================
// AUDIT LOGS
// =====================

// GetAuditLogs - Admin only: retrieve audit logs
func (c *EHRContract) GetAuditLogs(ctx contractapi.TransactionContextInterface, limit int) ([]*AuditLog, error) {
	if err := c.requireRole(ctx, RoleAdmin); err != nil {
		return nil, err
	}

	iterator, err := ctx.GetStub().GetStateByRange("LOG_", "LOG_~")
	if err != nil {
		return nil, err
	}
	defer iterator.Close()

	var logs []*AuditLog
	count := 0
	for iterator.HasNext() && (limit <= 0 || count < limit) {
		item, err := iterator.Next()
		if err != nil {
			continue
		}
		var log AuditLog
		if err := json.Unmarshal(item.Value, &log); err == nil {
			logs = append(logs, &log)
			count++
		}
	}

	return logs, nil
}

// VerifyRecordIntegrity - Verifies a record's hash on-chain
func (c *EHRContract) VerifyRecordIntegrity(ctx contractapi.TransactionContextInterface,
	recordID, providedHash string) (bool, error) {

	record, err := c.getRecord(ctx, recordID)
	if err != nil {
		return false, err
	}

	callerID, _ := ctx.GetClientIdentity().GetID()
	c.writeAuditLog(ctx, callerID, "VERIFY_INTEGRITY", "RECORD_"+recordID, "")

	return record.Hash == providedHash, nil
}

// =====================
// INTERNAL HELPERS
// =====================

func (c *EHRContract) getUser(ctx contractapi.TransactionContextInterface, userID string) (*User, error) {
	data, err := ctx.GetStub().GetState("USER_" + userID)
	if err != nil {
		return nil, err
	}
	if data == nil {
		return nil, fmt.Errorf("user %s not found", userID)
	}
	var user User
	json.Unmarshal(data, &user)
	return &user, nil
}

func (c *EHRContract) getRecord(ctx contractapi.TransactionContextInterface, recordID string) (*HealthRecord, error) {
	data, err := ctx.GetStub().GetState("RECORD_" + recordID)
	if err != nil {
		return nil, err
	}
	if data == nil {
		return nil, fmt.Errorf("record %s not found", recordID)
	}
	var record HealthRecord
	json.Unmarshal(data, &record)
	return &record, nil
}

func (c *EHRContract) getCallerRole(ctx contractapi.TransactionContextInterface) (Role, error) {
	callerID, err := ctx.GetClientIdentity().GetID()
	if err != nil {
		return "", err
	}
	user, err := c.getUser(ctx, callerID)
	if err != nil {
		return "", err
	}
	return user.Role, nil
}

func (c *EHRContract) requireRole(ctx contractapi.TransactionContextInterface, required Role) error {
	role, err := c.getCallerRole(ctx)
	if err != nil {
		return fmt.Errorf("failed to get caller role: %v", err)
	}
	if role != required {
		return fmt.Errorf("access denied: requires role %s, caller has role %s", required, role)
	}
	return nil
}

func (c *EHRContract) hasAccessGrant(ctx contractapi.TransactionContextInterface, recordID, doctorID string) bool {
	record, err := c.getRecord(ctx, recordID)
	if err != nil {
		return false
	}
	key := fmt.Sprintf("GRANT_%s_%s_%s", recordID, record.PatientID, doctorID)
	data, err := ctx.GetStub().GetState(key)
	if err != nil || data == nil {
		return false
	}
	var grant AccessGrant
	json.Unmarshal(data, &grant)
	return grant.Active
}

func (c *EHRContract) writeAuditLog(ctx contractapi.TransactionContextInterface,
	userID, action, resource, details string) error {

	txID := ctx.GetStub().GetTxID()
	now := time.Now().UTC().Format(time.RFC3339)
	logID := fmt.Sprintf("%s_%s", now, txID[:8])

	log := AuditLog{
		LogID:     logID,
		UserID:    userID,
		Action:    action,
		Resource:  resource,
		Timestamp: now,
		TxID:      txID,
		Details:   details,
	}

	data, _ := json.Marshal(log)
	return ctx.GetStub().PutState("LOG_"+logID, data)
}

// =====================
// MAIN
// =====================

func main() {
	chaincode, err := contractapi.NewChaincode(&EHRContract{})
	if err != nil {
		panic(fmt.Sprintf("Error creating EHR chaincode: %v", err))
	}
	if err := chaincode.Start(); err != nil {
		panic(fmt.Sprintf("Error starting EHR chaincode: %v", err))
	}
}
