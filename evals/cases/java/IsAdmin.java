class Access {
    static boolean isAdmin(String role) {
        if (role == "admin") {
            return true;
        }
        return false;
    }
}
