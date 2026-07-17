-- Seed cost centers + heads for the charges demo, from the canonical head list.
-- Recreates the 17 missing codes (1605.01–04, 1908, 2006, 2401/02/04/05/06/09/
-- 11/12/13, 2501/02) so every department can receive & route a charge, and
-- assigns each CC's head verbatim from the list. Headless "Other" CCs
-- (2001/2004/2006) go to fernanda; gabriel is head of ALL CCs for testing.
--
-- Idempotent: reuses the exact conflict keys the app import uses
-- (cost_centers ON CONFLICT (code); cost_center_heads ON CONFLICT
-- (cost_center_id, head_email)). Existing CCs keep their name/department and are
-- only (re)activated; missing CCs are created with the list's name/department.
--
-- Fernanda (fernanda.silva@vammo.com) is the head of the 3 headless "Other" CCs.

with rows(code, name, department, head_email, head_name) as (values
  ('1001','Marketing: Payroll','Marketing','joana@vammo.com','Joana Veiga'),
  ('1002','Marketing: Expenses','Marketing','joana@vammo.com','Joana Veiga'),
  ('1003','Marketing: Paid Media - Growth','Marketing','joana@vammo.com','Joana Veiga'),
  ('1004','Marketing: Advertising','Marketing','joana@vammo.com','Joana Veiga'),
  ('1005','Marketing: Branding Materials','Marketing','joana@vammo.com','Joana Veiga'),
  ('1006','Marketing: Licenses','Marketing','joana@vammo.com','Joana Veiga'),
  ('1101','Sales: Payroll - Sales team','Sales','joana@vammo.com','Joana Veiga'),
  ('1102','Sales: Payroll - Management','Sales','joana@vammo.com','Joana Veiga'),
  ('1103','Sales: Licenses','Sales','joana@vammo.com','Joana Veiga'),
  ('1104','Sales: Drivers'' Expenses','Sales','joana@vammo.com','Joana Veiga'),
  ('1105','Sales: Expenses','Sales','joana@vammo.com','Joana Veiga'),
  ('1106','Sales: Real Estate','Sales','joana@vammo.com','Joana Veiga'),
  ('1201','CX: Licenses','CX','lidia@vammo.com','Lidia Gordijo'),
  ('1202','CX: Drivers'' Expenses','CX','lidia@vammo.com','Lidia Gordijo'),
  ('1204','CX: Payroll - Backoffice','CX','lidia@vammo.com','Lidia Gordijo'),
  ('1205','CX: Payroll - CX management','CX','lidia@vammo.com','Lidia Gordijo'),
  ('1206','CX: Expenses','CX','lidia@vammo.com','Lidia Gordijo'),
  ('1207','CX: Entrega - Payroll','CX','lidia@vammo.com','Lidia Gordijo'),
  ('1301','Tech: Payroll','Tech','daniela@vammo.com','Daniela Rocha'),
  ('1302','Tech: Expenses','Tech','daniela@vammo.com','Daniela Rocha'),
  ('1303','Tech: Licenses','Tech','daniela@vammo.com','Daniela Rocha'),
  ('1401','Hardware: Payroll','Hardware','rodrigo@vammo.com','Rodrigo Castellari'),
  ('1402','Hardware: Expenses','Hardware','rodrigo@vammo.com','Rodrigo Castellari'),
  ('1403','Hardware: Licenses','Hardware','rodrigo@vammo.com','Rodrigo Castellari'),
  ('1404','Hardware: Real Estate','Hardware','rodrigo@vammo.com','Rodrigo Castellari'),
  ('1405','Hardware: Projects','Hardware','rodrigo@vammo.com','Rodrigo Castellari'),
  ('1501','Finance & Controlling: Payroll','Finance','nara@vammo.com','Nara Cury'),
  ('1502','Finance & Controlling: Third Party / Consultants','Finance','nara@vammo.com','Nara Cury'),
  ('1503','Finance & Controlling: Licenses','Finance','nara@vammo.com','Nara Cury'),
  ('1504','Finance & Controlling: Expenses','Finance','nara@vammo.com','Nara Cury'),
  ('1601','Corporate: Payroll','Corporate','nara@vammo.com','Nara Cury'),
  ('1602','Corporate: Licenses','Corporate','nara@vammo.com','Nara Cury'),
  ('1603','Corporate: Expenses','Corporate','nara@vammo.com','Nara Cury'),
  ('1604','Corporate: Third Party / Consultants','Corporate','nara@vammo.com','Nara Cury'),
  ('1605','Corporate: Finance expenses','Corporate','nara@vammo.com','Nara Cury'),
  ('1605.01','Corporate: Finance expenses – Motorcycles Sales Pro','Corporate','nara@vammo.com','Nara Cury'),
  ('1605.02','Corporate: Finance expenses – Sales of New Motorcyc','Corporate','nara@vammo.com','Nara Cury'),
  ('1605.03','Corporate: Finance expenses – Sales of Used Motorcy','Corporate','nara@vammo.com','Nara Cury'),
  ('1605.04','Corporate: Finance expenses – Spare Parts Sales Mot','Corporate','nara@vammo.com','Nara Cury'),
  ('1701','Legal: Payroll','Legal','pablo@vammo.com','Pablo Estrela'),
  ('1702','Legal: Licenses','Legal','pablo@vammo.com','Pablo Estrela'),
  ('1703','Legal: Expenses','Legal','pablo@vammo.com','Pablo Estrela'),
  ('1704','Legal: Third Party Services / Consultants','Legal','pablo@vammo.com','Pablo Estrela'),
  ('1801','HR: Payroll','HR','gabriela@vammo.com','Gabriela Silva'),
  ('1802','HR: Licenses','HR','gabriela@vammo.com','Gabriela Silva'),
  ('1803','HR: Expenses','HR','gabriela@vammo.com','Gabriela Silva'),
  ('1804','HR: Third Party Services / Consultants','HR','gabriela@vammo.com','Gabriela Silva'),
  ('1901','Facilities: Payroll','Facilities','paula@vammo.com','Paula Cunha'),
  ('1902','Facilities: Real estate','Facilities','paula@vammo.com','Paula Cunha'),
  ('1903','Facilities: Utilities','Facilities','paula@vammo.com','Paula Cunha'),
  ('1904','Facilities: Maintenance','Facilities','paula@vammo.com','Paula Cunha'),
  ('1905','Facilities: Supplies / Services','Facilities','paula@vammo.com','Paula Cunha'),
  ('1906','Facilities: EPI & Uniforms','Facilities','paula@vammo.com','Paula Cunha'),
  ('1907','Facilities: Expenses','Facilities','paula@vammo.com','Paula Cunha'),
  ('1908','Facilities: TI','Facilities','paula@vammo.com','Paula Cunha'),
  ('2001','Other - Income/Expenses: Other - Income','Other','fernanda.silva@vammo.com','Fernanda'),
  ('2004','Other - Income/Expenses: Profit/Loss on sales of Asset','Other','fernanda.silva@vammo.com','Fernanda'),
  ('2006','Other - Bad Debts','Other','fernanda.silva@vammo.com','Fernanda'),
  ('2406','CapEx: Cabinets - Instalation cost','Charging','eduardo.romitelli@vammo.com','Eduardo Romitelli'),
  ('2407','CapEx: Motorcycle Trunk','Supply','pablo@vammo.com','Pablo Estrela'),
  ('2601','Supply Chain: Payroll','Supply','pablo@vammo.com','Pablo Estrela'),
  ('2602','Supply Chain: Expenses','Supply','pablo@vammo.com','Pablo Estrela'),
  ('2701','Operational Real Estate: Real State','Operational Real Estate','fernanda.silva@vammo.com','Fernanda'),
  ('401','Charging Infra/Energy: Electricity','Charging','eduardo.romitelli@vammo.com','Eduardo Romitelli'),
  ('402','Charging Infra/Energy: Cabinets Real Estate','Charging','eduardo.romitelli@vammo.com','Eduardo Romitelli'),
  ('403','Charging Infra/Energy: Manual Swapping Stations','Charging','eduardo.romitelli@vammo.com','Eduardo Romitelli'),
  ('404','Charging Infra/Energy: Spare Parts - Battery','Charging','eduardo.romitelli@vammo.com','Eduardo Romitelli'),
  ('405','Charging Infra/Energy: Spare Parts - Battery Box','Charging','eduardo.romitelli@vammo.com','Eduardo Romitelli'),
  ('406','Charging Infra/Energy: Battery Box Patrol payroll','Charging','eduardo.romitelli@vammo.com','Eduardo Romitelli'),
  ('408','Charging Infra/Energy: Battery Maintenance payroll','Charging','eduardo.romitelli@vammo.com','Eduardo Romitelli'),
  ('409','Charging Infra/Energy: Cabinets Maintenance payroll','Charging','eduardo.romitelli@vammo.com','Eduardo Romitelli'),
  ('410','Charging Infra/Energy: Cabinets OpEx','Charging','eduardo.romitelli@vammo.com','Eduardo Romitelli'),
  ('501','Vehicle OpEx: Connectivity Costs / IOTs','Fleet','paula@vammo.com','Paula Cunha'),
  ('502','Vehicle OpEx: Maintenance Real Estate','Maintenence','joao.chalela@vammo.com','João Chalela'),
  ('503','Vehicle OpEx: Mechanics & Quality payroll','Maintenence','joao.chalela@vammo.com','João Chalela'),
  ('504','Vehicle OpEx: Inventory payroll','Supply','pablo@vammo.com','Pablo Estrela'),
  ('505','Vehicle OpEx: Registration Costs / IPVA','Fleet','paula@vammo.com','Paula Cunha'),
  ('506','Vehicle OpEx: Spare Parts corrective cost','Fleet','paula@vammo.com','Paula Cunha'),
  ('507','Vehicle OpEx: Spare Parts preventive cost','Fleet','paula@vammo.com','Paula Cunha'),
  ('508','Vehicle OpEx: Spare Parts reimbursement','Fleet','paula@vammo.com','Paula Cunha'),
  ('510','Vehicle OpEx: Spare Parts guarantee credit note','Fleet','paula@vammo.com','Paula Cunha'),
  ('511','Vehicle OpEx: Claims Reimbursment','CX','lidia@vammo.com','Lidia Gordijo'),
  ('512','Vehicle OpEx: Claims','CX','lidia@vammo.com','Lidia Gordijo'),
  ('513','Vehicle OpEx: Tools, Material & Equipment','Maintenence','joao.chalela@vammo.com','João Chalela'),
  ('514','Vehicle OpEx: Traffic Fines Cost','CX','lidia@vammo.com','Lidia Gordijo'),
  ('515','Vehicle OpEx: Traffic Fines Reimbursement','CX','lidia@vammo.com','Lidia Gordijo'),
  ('516','Vehicle OpEx: Traffic Fines payroll','CX','lidia@vammo.com','Lidia Gordijo'),
  ('518','Vehicle OpEx: Licenses - Ops','Fleet','paula@vammo.com','Paula Cunha'),
  ('520','Vehicle OpEx: Loss Prevention','Fleet','paula@vammo.com','Paula Cunha'),
  ('522','Vehicle OpEx: Towing costs','Maintenence','joao.chalela@vammo.com','João Chalela'),
  ('523','Vehicle OpEx: Bike recovery costs - Third party','Maintenence','joao.chalela@vammo.com','João Chalela'),
  ('524','Vehicle OpEx: Bike recovery Reimbursement','Maintenence','joao.chalela@vammo.com','João Chalela'),
  ('601','Customer Service and Support: CX Piso payroll','CX','lidia@vammo.com','Lidia Gordijo'),
  ('602','Customer Service and Support: CX Online payroll','CX','lidia@vammo.com','Lidia Gordijo'),
  ('604','Customer Service and Support: CX Tools','CX','lidia@vammo.com','Lidia Gordijo'),
  ('605','Customer Service and Support: CX Real Estate','CX','lidia@vammo.com','Lidia Gordijo'),
  ('701','Fleet Management: Payroll','Fleet','paula@vammo.com','Paula Cunha'),
  ('702','Fleet Management: Expenses','Fleet','paula@vammo.com','Paula Cunha'),
  ('703','Fleet Management: Licenses','Fleet','paula@vammo.com','Paula Cunha'),
  ('704','Fleet Management: Real Estate','Fleet','paula@vammo.com','Paula Cunha'),
  ('801','Charging Ops: Payroll','Charging','eduardo.romitelli@vammo.com','Eduardo Romitelli'),
  ('802','Charging Ops: Expenses','Charging','eduardo.romitelli@vammo.com','Eduardo Romitelli'),
  ('901','Maintenance Ops: Payroll','Maintenence','joao.chalela@vammo.com','João Chalela'),
  ('903','Maintenance Ops: Expenses','Maintenence','joao.chalela@vammo.com','João Chalela'),
  ('904','Maintenance Ops: Mechanics Payroll - In Training','Maintenence','joao.chalela@vammo.com','João Chalela'),
  ('2401','CapEx: Motorcycles','Supply','pablo@vammo.com','Pablo Estrela'),
  ('2402','CapEx: Batteries','Supply','pablo@vammo.com','Pablo Estrela'),
  ('2404','CapEx: Plating Costs','Fleet','paula@vammo.com','Paula Cunha'),
  ('2405','CapEx: Cabinets','Supply','pablo@vammo.com','Pablo Estrela'),
  ('2409','CapEx: IT equipment','HR','gabriela@vammo.com','Gabriela Silva'),
  ('2411','CapEx: Real Estate','Fleet','paula@vammo.com','Paula Cunha'),
  ('2412','CapEx: Vehicles and Utility Vehicles','Maintenence','joao.chalela@vammo.com','João Chalela'),
  ('2413','CapEx: Maintenance Tools & Equipment','Maintenence','joao.chalela@vammo.com','João Chalela'),
  ('2501','Inventory: Spare parts inventory','Supply','pablo@vammo.com','Pablo Estrela'),
  ('2502','Inventory: Vammo store inventory','Sales','joana@vammo.com','Joana Veiga')
)
-- 1) Create the missing CCs (list name/department); (re)activate existing ones
--    without renaming them.
, upsert_cc as (
  insert into finance.cost_centers (code, name, department, active)
  select code, name, department, true from rows
  on conflict (code) do update set active = true
  returning id, code
)
-- 2) Assign each CC's head verbatim from the list (fernanda for the headless).
insert into finance.cost_center_heads (cost_center_id, head_email, head_name)
select c.id, lower(r.head_email), r.head_name
from rows r
join finance.cost_centers c on c.code = r.code
where r.head_email like '%@vammo.com'
on conflict (cost_center_id, head_email) do update set head_name = excluded.head_name;

-- 3) Gabriel is a head of ALL cost centers (testing).
insert into finance.cost_center_heads (cost_center_id, head_email, head_name)
select id, 'gabriel.beltrami@vammo.com', 'Gabriel Beltrami' from finance.cost_centers
on conflict (cost_center_id, head_email) do nothing;
