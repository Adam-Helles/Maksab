# test_debt_sync.ps1
#
# Tests the full "offline debt payment -> sync" scenario end-to-end
# by calling the same endpoints the mobile app uses, without opening
# the app at all.
#
# Before running:
#   1. Backend must be running (uvicorn ...)
#   2. Edit $username and $password below with your real admin credentials
#   3. Run it: powershell -ExecutionPolicy Bypass -File test_debt_sync.ps1

$ErrorActionPreference = "Stop"

$BaseUrl  = "http://10.5.2.127:8000/api/v1"
$username = "admin"        # <-- EDIT: your actual admin username
$password = "CHANGE_ME"    # <-- EDIT: your actual admin password
$customerId = 0            # <-- EDIT: set the customer's numeric id here if known. Leave 0 to auto-pick the only/first customer returned.
$paymentAmount = 50.0

function Write-Step($msg) {
    Write-Host ""
    Write-Host "== $msg ==" -ForegroundColor Cyan
}

function Write-Ok($msg) {
    Write-Host "[OK] $msg" -ForegroundColor Green
}

function Write-Fail($msg) {
    Write-Host "[FAIL] $msg" -ForegroundColor Red
}

# -- 1) Login --------------------------------------------
Write-Step "1) Login"
try {
    $loginBody = @{ username = $username; password = $password } | ConvertTo-Json
    $loginResp = Invoke-RestMethod -Uri "$BaseUrl/auth/login" -Method Post `
        -ContentType "application/json; charset=utf-8" -Body $loginBody
    $accessToken = $loginResp.access_token
    Write-Ok "Login succeeded, user: $($loginResp.user.username)"
} catch {
    Write-Fail "Login failed: $($_.Exception.Message)"
    if ($_.ErrorDetails.Message) { Write-Host $_.ErrorDetails.Message }
    exit 1
}

$headers = @{ Authorization = "Bearer $accessToken" }

# -- 2) Find customer and check current debt -------------
Write-Step "2) Fetching customer"
try {
    if ($customerId -gt 0) {
        $customer = Invoke-RestMethod -Uri "$BaseUrl/customers/$customerId" -Method Get -Headers $headers
    } else {
        $customers = Invoke-RestMethod -Uri "$BaseUrl/customers/" -Method Get -Headers $headers
        if ($customers.Count -eq 0) {
            Write-Fail "No customers found at all in this store."
            exit 1
        }
        if ($customers.Count -gt 1) {
            Write-Host "Multiple customers found, using the first one. Set `$customerId at the top of the script to target a specific one:"
            foreach ($c in $customers) { Write-Host "  - id=$($c.id) debt=$($c.current_debt)" }
        }
        $customer = $customers[0]
    }
    Write-Ok "Using customer id=$($customer.id), current debt: $($customer.current_debt)"
} catch {
    Write-Fail "Failed to fetch customer: $($_.Exception.Message)"
    exit 1
}

$customerId = $customer.id
$debtBefore = $customer.current_debt

# -- 3) Simulate an offline payment via the sync endpoint --
Write-Step "3) Simulating an offline payment (amount: $paymentAmount)"
$paymentId = [guid]::NewGuid().ToString()
$clientCreatedAt = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.ffffff")

$paymentPayload = @{
    payments = @(
        @{
            id = $paymentId
            customer_id = $customerId
            amount = $paymentAmount
            method = "cash"
            client_created_at = $clientCreatedAt
        }
    )
} | ConvertTo-Json -Depth 5

try {
    $syncResp1 = Invoke-RestMethod -Uri "$BaseUrl/sync/customers/payments/push" -Method Post `
        -Headers $headers -ContentType "application/json" -Body $paymentPayload

    if ($syncResp1.accepted -contains $paymentId) {
        Write-Ok "Payment accepted by server: $paymentId"
    } else {
        Write-Fail "Payment did NOT appear in 'accepted'. Full response:"
        $syncResp1 | ConvertTo-Json -Depth 5 | Write-Host
        exit 1
    }
} catch {
    Write-Fail "Call to /sync/customers/payments/push failed: $($_.Exception.Message)"
    if ($_.ErrorDetails.Message) { Write-Host $_.ErrorDetails.Message }
    exit 1
}

# -- 4) Confirm the debt actually updated server-side ------
Write-Step "4) Confirming debt after payment"
$expectedDebt = [math]::Max(0, $debtBefore - $paymentAmount)

try {
    $customerAfter = Invoke-RestMethod -Uri "$BaseUrl/customers/$customerId" -Method Get -Headers $headers
    Write-Host "Debt before: $debtBefore | Expected after: $expectedDebt | Actual after: $($customerAfter.current_debt)"

    if ([math]::Abs($customerAfter.current_debt - $expectedDebt) -lt 0.001) {
        Write-Ok "Debt updated correctly on the server!"
    } else {
        Write-Fail "Debt did NOT update as expected!"
        exit 1
    }
} catch {
    Write-Fail "Failed to fetch customer after payment: $($_.Exception.Message)"
    exit 1
}

# -- 5) Idempotency test: resend the SAME payment id -------
Write-Step "5) Resending the same payment (idempotency test)"
try {
    $syncResp2 = Invoke-RestMethod -Uri "$BaseUrl/sync/customers/payments/push" -Method Post `
        -Headers $headers -ContentType "application/json" -Body $paymentPayload

    if ($syncResp2.already_applied -contains $paymentId) {
        Write-Ok "Duplicate request correctly rejected (already_applied) -- idempotency works"
    } else {
        Write-Fail "Duplicate request was NOT rejected! Debt could be double-deducted in real use. Response:"
        $syncResp2 | ConvertTo-Json -Depth 5 | Write-Host
        exit 1
    }

    $customerFinal = Invoke-RestMethod -Uri "$BaseUrl/customers/$customerId" -Method Get -Headers $headers
    if ([math]::Abs($customerFinal.current_debt - $expectedDebt) -lt 0.001) {
        Write-Ok "Debt still $($customerFinal.current_debt) (no double deduction) -- correct"
    } else {
        Write-Fail "Debt changed after the duplicate request ($($customerFinal.current_debt)) -- idempotency bug!"
        exit 1
    }
} catch {
    Write-Fail "Idempotency test failed: $($_.Exception.Message)"
    exit 1
}

Write-Host ""
Write-Host "ALL TESTS PASSED -- offline debt payment + sync scenario works end to end." -ForegroundColor Green