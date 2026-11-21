from django.contrib.auth.models import User
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import serializers

from .models import Interview, Job, TrackedEmail


class JobSerializer(serializers.ModelSerializer):
    # Sent only when an application is created from a Gmail message (or a
    # Gmail message is used to update its status). Never stored on the Job;
    # the view records it in TrackedEmail.
    gmail_message_id = serializers.CharField(
        write_only=True,
        required=False,
        allow_blank=True,
        max_length=100,
    )

    class Meta:
        model = Job
        fields = [
            'id', 'company_name', 'job_role', 'location', 'salary', 'status',
            'applied_date', 'description', 'job_url', 'follow_up_date',
            'deadline', 'created_at', 'updated_at', 'gmail_message_id',
        ]
        read_only_fields = ('created_at', 'updated_at')

    def validate_salary(self, value):
        if value is not None and value < 0:
            raise serializers.ValidationError("Salary cannot be negative.")

        return value

    def validate(self, attrs):
        message_id = attrs.get('gmail_message_id')

        # Duplicate prevention: one Gmail message can only become one
        # application. Checked on create only.
        if message_id and self.instance is None:
            user = self.context['request'].user

            already_tracked = TrackedEmail.objects.filter(
                user=user,
                gmail_message_id=message_id,
                action='tracked',
            ).exists()

            if already_tracked:
                raise serializers.ValidationError({
                    'gmail_message_id':
                        "This email has already been tracked as an application."
                })

        return attrs


class InterviewSerializer(serializers.ModelSerializer):
    # Read-only copies of the parent job's fields, so the frontend can show
    # "Acme - Python Developer" without a second request.
    company_name = serializers.CharField(
        source='job.company_name', read_only=True
    )
    job_role = serializers.CharField(source='job.job_role', read_only=True)

    class Meta:
        model = Interview
        fields = [
            'id', 'job', 'company_name', 'job_role', 'round_name',
            'interview_type', 'scheduled_at', 'meeting_link', 'location',
            'notes', 'outcome', 'created_at', 'updated_at',
        ]
        read_only_fields = ('created_at', 'updated_at')

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)

        # Only the user's own applications are valid choices. Someone else's
        # job ID fails exactly like an ID that does not exist.
        request = self.context.get('request')

        if request is not None:
            self.fields['job'].queryset = Job.objects.filter(user=request.user)


class RegisterSerializer(serializers.ModelSerializer):
    email = serializers.EmailField(required=True)
    password = serializers.CharField(write_only=True)
    first_name = serializers.CharField(
        required=False, allow_blank=True, max_length=150
    )

    class Meta:
        model = User
        fields = ['id', 'username', 'first_name', 'email', 'password']

    def validate_username(self, value):
        if User.objects.filter(username__iexact=value).exists():
            raise serializers.ValidationError(
                "A user with that username already exists."
            )

        return value

    def validate_email(self, value):
        if User.objects.filter(email__iexact=value).exists():
            raise serializers.ValidationError(
                "An account with this email already exists."
            )

        return value.lower()

    def validate(self, attrs):
        # Run Django's password rules (length, common passwords, too similar
        # to the username, all numeric).
        candidate = User(username=attrs.get('username'), email=attrs.get('email'))

        try:
            validate_password(attrs['password'], user=candidate)
        except DjangoValidationError as error:
            raise serializers.ValidationError({'password': list(error.messages)})

        return attrs

    def create(self, validated_data):
        # create_user stores a salted hash, never the raw password.
        return User.objects.create_user(
            username=validated_data['username'],
            email=validated_data['email'],
            password=validated_data['password'],
            first_name=validated_data.get('first_name', ''),
        )


class ProfileSerializer(serializers.ModelSerializer):
    """The logged-in user's own account. The username cannot be changed."""

    email = serializers.EmailField(required=True)

    class Meta:
        model = User
        fields = ['id', 'username', 'first_name', 'last_name', 'email']
        read_only_fields = ('username',)

    def validate_email(self, value):
        # Unique among everyone except the user themselves.
        taken = User.objects.filter(email__iexact=value).exclude(
            pk=self.instance.pk
        )

        if taken.exists():
            raise serializers.ValidationError(
                "An account with this email already exists."
            )

        return value.lower()


class ChangePasswordSerializer(serializers.Serializer):
    current_password = serializers.CharField(write_only=True)
    new_password = serializers.CharField(write_only=True)

    def validate_current_password(self, value):
        if not self.context['request'].user.check_password(value):
            raise serializers.ValidationError("Current password is incorrect.")

        return value

    def validate_new_password(self, value):
        try:
            validate_password(value, user=self.context['request'].user)
        except DjangoValidationError as error:
            raise serializers.ValidationError(list(error.messages))

        return value

